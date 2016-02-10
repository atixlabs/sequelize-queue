'use strict'
// --------------------
// Sequelize queue
// --------------------

// modules
var _ = require( 'lodash' ),
	Log = require( 'log' ),
	Promise = require( 'bluebird' );


// Create a new object, that prototypally inherits from the Error constructor
function JobFailedError( message ) {
	this.name = 'JobFailedError';
	this.message = message || 'Default Message';
	this.stack = ( new Error() ).stack;
}
JobFailedError.prototype = Object.create( Error.prototype );
JobFailedError.prototype.constructor = JobFailedError;


// Queue class
var Queue = function( sequelize, options ) {
	// set default options
	this.options = options = _.extend( {
		modelName: 'queue',
		logger: new Log( -1 ),
		polltime: 1000
	}, options || {} );

	// save options to this
	_.extend( this, {
		model: options.model,
		processors: options.processors || {},
		successHandlers: options.successHandlers || {},
		errorHandlers: options.errorHandlers || {}
	} );

	// if only one processor or errorHandler, make it of default type
	if ( _.isFunction( this.processors ) ) this.processors = {
		default: this.processors
	};
	if ( _.isFunction( this.errorHandlers ) ) this.errorHandlers = {
		default: this.errorHandlers
	};

	// save sequelize to this
	this.sequelize = sequelize;

	// set running as false
	this.running = undefined;
	this.started = false;
};

// priority constants
_.extend( Queue, {
	PRIORITY_HIGH: 20,
	PRIORITY_DEFAULT: 10,
	PRIORITY_LOW: 0
} );

// prototype methods
_.extend( Queue.prototype, {
	// initializes model
	// returns a Promise
	init: function( force ) {
		// create sequelize model for queue
		if ( this.model ) {
			return Promise.resolve();
		} else {
			var Sequelize = this.sequelize.Sequelize;
			if ( !Sequelize.DATETIME ) Sequelize.DATETIME = Sequelize.DATE;

			this.model = this.sequelize.define( this.options.modelName, {
				type: {
					type: Sequelize.STRING( 100 ),
					allowNull: false
				},
				priority: {
					type: Sequelize.INTEGER,
					allowNull: false,
					defaultValue: Queue.PRIORITY_DEFAULT
				},
				retryInterval: {
					type: Sequelize.INTEGER,
					allowNull: true
				},
				data: {
					type: Sequelize.TEXT,
					allowNull: true
				},
				result: {
					type: Sequelize.TEXT,
					allowNull: true
				},
				running: {
					type: Sequelize.BOOLEAN,
					allowNull: false,
					defaultValue: false
				},
				done: {
					type: Sequelize.BOOLEAN,
					allowNull: false,
					defaultValue: false
				},
				failed: {
					type: Sequelize.BOOLEAN,
					allowNull: false,
					defaultValue: false
				},
				deleteAfterExecution: {
					type: Sequelize.BOOLEAN,
					allowNull: false,
					defaultValue: false
				},
				dateAdded: {
					type: Sequelize.DATETIME,
					allowNull: false
				},
				dateNextRun: {
					type: Sequelize.DATETIME,
					allowNull: true
				},
				dateStarted: {
					type: Sequelize.DATETIME,
					allowNull: true
				},
				dateFinished: {
					type: Sequelize.DATETIME,
					allowNull: true
				}
			} );

			return this.model.sync()
				.return( {
					force: force
				} );
		}
	},

	// starts processing any jobs in the queue
	// does not return
	start: function() {
		this.started = true;
		runQueue( this );
	},

	stop: function() {
		this.started = false;

		const LOGGER = this.options.logger;
		LOGGER.info( 'Stoping queue. Running? %s', this.running !== undefined );
		if ( this.running ) {
			return this.running.then( () => {
				LOGGER.info( 'Queue stopped' );
				return true;
			} )
		}
		return Promise.resolve( true )
	},

	// adds a job to the queue
	// return a Promise
	addJob: function( data, optionsParam ) {

		const options = optionsParam || {}
		const type = options.type || 'default'
		const priority = options.priority || Queue.PRIORITY_DEFAULT
		const retryInterval = options.retryInterval || null
		const startOn = options.startOn || null
		const deleteAfterExecution = options.deleteAfterExecution || false

		// check there is a processor for this type of job
		if ( !this.processors[ type ] ) return Promise.reject( new Error( "No processor defined for a job of type '" + type + "'" ) );

		// turn data into JSON
		data = ( ( data !== undefined ) ? JSON.stringify( data ) : null );

		return Promise.bind( this ).then( function() {
			// add job to queue
			return this.model.create( {
				type: type,
				priority: priority,
				retryInterval: retryInterval,
				data: data,
				dateAdded: new Date(),
				dateNextRun: startOn,
				deleteAfterExecution: deleteAfterExecution
			} );
		} ).then( function( job ) {
			// run the queue
			if ( this.started ) runQueue( this );

			// return the job model instance
			return job;
		} );
	},

	failJob: function( msg ) {
		throw new JobFailedError( msg )
	}

} );

function getSaveOrDelete( job ) {
	let action = job.save.bind( job )
	if ( job.deleteAfterExecution )
		action = job.destroy.bind( job )
	return action
}

function runDelayed( queue ) {
	const LOGGER = queue.options.logger;
	setTimeout( () => {
		LOGGER.debug( 'Automatic queue run' )
		runQueue( queue )
	}, queue.options.polltime )
}

function runQueue( queue ) {
	if ( !queue.started ) return;

	// if already in process, exit
	if ( queue.running !== undefined ) return queue.running;

	const LOGGER = queue.options.logger;
	const Sequelize = queue.sequelize

	// run the next job
	var transaction;
	queue.running = Promise.try( function() {
			// start transaction
			return queue.sequelize.transaction( {
					isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED
				} )
				.then( function( _transaction ) {
					transaction = _transaction;
				} );
		} ).then( function() {
			// get next item in queue
			return queue.model.find( {
				where: Sequelize.and( {
						done: false
					}, {
						running: false
					}, {
						failed: false
					},
					Sequelize.or( {
						dateNextRun: {
							$eq: null
						}
					}, {
						dateNextRun: {
							$lt: new Date()
						}
					} )
				),
				order: [
					[ 'priority', 'DESC' ],
					[ 'dateAdded', 'ASC' ]
				]
			}, {
				transaction: transaction
			} );
		} ).tap( function( job ) {
			// set as running
			if ( job ) {
				return job.updateAttributes( {
					running: true,
					dateStarted: new Date()
				}, {
					transaction: transaction
				} );
			}
		} )
		.tap( function() {
			// commit transaction
			if ( transaction )
				return transaction.commit();
		} )
		.catch( function( err ) {
			LOGGER.error( err )
				// if error, rollback transaction and rethrow error
			return Promise.try( function() {
					if ( transaction ) return transaction.rollback();
				} )
				.then( function() {
					// rethrow error
					return Promise.reject( err );
				} );
		} )
		.then( function( job ) {
			// if no job found, try to find another job in a while
			if ( !job ) {
				LOGGER.debug( 'No job to run found' )
				return;
			}

			LOGGER.debug( 'Running job %s', job.id )
				// run the job
			return queue.processors[ job.type ]( JSON.parse( job.data ) )
				.then( function( result ) {
					// mark job as done
					job.running = false;
					job.done = true;
					job.dateFinished = new Date();
					job.result = JSON.stringify( result );

					LOGGER.debug( 'Saving job %s', job.id )

					return getSaveOrDelete( job )()
						.then( function() {
							var successHandler = queue.successHandlers[ job.type ];
							if ( successHandler ) successHandler( job.result, job.id );
						} )
						.catch( function( err ) {
							var errorHandler = queue.errorHandlers[ job.type ];
							if ( errorHandler ) errorHandler( err, job.data, job.id );
						} )
						.then( function() {
							return job
						} )
				} )
				.catch( function( err ) {
					// mark job as failed
					job.running = false;
					LOGGER.error( 'Job %s failed', job.id )
					let endAction
					if ( ( job.retryInterval !== null ) && ( err.name !== 'JobFailedError' ) ) {
						const currentDate = new Date()
						const nextRun = new Date( currentDate.getTime() + job.retryInterval )
						job.dateNextRun = nextRun
						LOGGER.info( 'Job %s will be re-runned at', job.id, nextRun )
						endAction = job.save()
					} else {
						job.failed = true;
						job.dateFinished = new Date();
						job.result = JSON.stringify( err );
						endAction = getSaveOrDelete( job )()
					}
					return endAction
						.then( function() {
							var errorHandler = queue.errorHandlers[ job.type ];
							if ( errorHandler ) errorHandler( err, job.data );
							return job
						} );
				} )

		} ).then( function( job ) {
			// flag as not currently running
			job ? LOGGER.info( 'Finish job %s run', job.id ) : LOGGER.warning( 'No job run this time' )


			const runningPromise = queue.running
			queue.running = undefined
			Promise.resolve( runningPromise );
			// run immediatly if job found or wait if nothing was executed
			if ( job ) {
				process.nextTick( function() {
					runQueue( queue );
				} );
			} else {
				runDelayed( queue )
			}
		} );

	return queue.running
}

module.exports = function createQueue( sequelize, options ) {
	return new Queue( sequelize, options )
}
