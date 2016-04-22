'use strict'
// --------------------
// Sequelize queue
// Tests
// --------------------

// modules
var chai = require('chai'),
	expect = chai.expect,
	promised = require('chai-as-promised'),
	Support = require(__dirname + '/support'),
	Sequelize = Support.Sequelize,
	Promise = Sequelize.Promise,
	_ = require('lodash'),
	createQueue = require('../lib/');

// init
chai.use(promised);
chai.config.includeStack = true;

function defaultProcessor(data) {
	return Promise.delay(100).then(function () {
		return {
			b: data.a
		};
	});
}

function mustFailOnceProcessor() {
	let mustFail = true

	return function (data) {
		return Promise.delay(100).then(function () {
			if (mustFail) {
				mustFail = !mustFail
				throw new Error('This job failed this time')
			}
			return {
				b: data.a
			};
		});
	}
}

function addJobWithPriority(queue, num) {
	return queue.addJob({
		a: num
	}, {
			priority: num * 2
		})
}

function insertRunningJob(model) {
	return model.create({
		type: 'default',
		priority: 0,
		retryInterval: 100,
		data: JSON.stringify({
			a: 1
		}),
		dateAdded: new Date(),
		deleteAfterExecution: false,
		running: true
	});
}

// tests
describe(Support.getTestDialectTeaser('Tests'), function () {
	this.timeout(10000)

	it('It works!', function () {
		var results = [];
		var queue = createQueue(this.sequelize, {
			processors: {
				default: defaultProcessor
			}
		});

		return queue.init()
			.then(() => {
				return queue.start()
			})
			.then(function () {

				return Promise.each([1, 2, 3], function (num) {
					return queue.addJob({
						a: num
					});
				})
					.delay(500)
					.then(function () {
						return queue.stop()
					})
					.then(function () {
						return queue.model.findAll({
							order: [
								['id']
							]
						})
							.then(function (results) {
								expect(results).to.be.ok;
								expect(results.length).to.equal(3);

								results.forEach(function (result, index) {
									var data = JSON.parse(result.result);
									expect(data.b).to.equal(index + 1);
								});
							});
					});
			});
	});

	describe('Basic operations', function () {
		it('Sould reject a job if processor insn\'t defined', function () {
			var queue = createQueue(this.sequelize, {})

			const result = queue.init()
				.then(function () {
					return queue.start();
				})
				.then(function () {
					return queue.addJob({
						a: 1
					})
				})
				.delay(100)
				.catch(err => {
					expect(err.message).to.be.equal('No processor defined for a job of type \'default\'')
				})
				.finally(() => {
					return queue.stop()
				})
			return result;
		})

		it('SuccessHandler should be called if defined', function () {
			let successHandlerCalled = false
			let errorHandlerCalled = false
			var queue = createQueue(this.sequelize, {
				processors: {
					default: defaultProcessor
				},
				successHandlers: {
					default: function (result, jobId) {
						// TODO params should be checked
						successHandlerCalled = true
					}
				},
				errorHandlers: {
					default: function (err, jobData, jobId) {
						errorHandlerCalled = true
					}

				}
			})

			return queue.init()
				.then(function () {
					return queue.addJob({
						a: 1
					})
				})
				.then(function () {
					return queue.start();
				})
				.delay(100)
				.then(() => {
					return queue.stop()
				})
				.then(() => {
					expect(successHandlerCalled).to.equal(true)
					expect(errorHandlerCalled).to.equal(false)
				})

		})

		it('ErrorHandler should be called if defined', function () {
			let successHandlerCalled = false
			let errorHandlerCalled = false
			var queue = createQueue(this.sequelize, {
				processors: {
					default: mustFailOnceProcessor()
				},
				successHandlers: {
					default: function (result, jobId) {
						successHandlerCalled = true
					}
				},
				errorHandlers: {
					default: function (err, jobData, jobId) {
						// TODO params should be checked
						errorHandlerCalled = true
					}

				}
			})

			return queue.init()
				.then(function () {
					return queue.addJob({
						a: 1
					})
				})
				.then(function () {
					return queue.start();
				})
				.delay(100)
				.then(() => {
					return queue.stop()
				})
				.then(() => {
					expect(successHandlerCalled).to.equal(false)
					expect(errorHandlerCalled).to.equal(true)
				})

		})

		it('Should sort by priority', function () {
			var queue = createQueue(this.sequelize, {
				processors: {
					default: defaultProcessor
				}
			});

			return queue.init()
				.then(() => {
					return addJobWithPriority(queue, 1);
				})
				.then(() => {
					return addJobWithPriority(queue, 2);
				})
				.then(() => {
					return addJobWithPriority(queue, 3);
				})
				.then(() => {
					return queue.start();
				})
				.delay(1000)
				.then(function () {
					return queue.stop()
				})
				.then(function () {
					return queue.model.findAll({
						order: [
							['dateFinished', 'ASC']
						]
					})
						.then(function (results) {
							expect(results).to.be.ok;
							expect(results.length).to.equal(3);
							expect(JSON.parse(results[0].result).b).to.equal(3)
							expect(JSON.parse(results[1].result).b).to.equal(2)
							expect(JSON.parse(results[2].result).b).to.equal(1)
						});
				});
		});

		it('Should not run a running job by default', function () {
			var queue = createQueue(this.sequelize, {
				processors: {
					default: defaultProcessor
				}
			});

			return queue.init()
				.then(() => {
					return insertRunningJob(queue.model)
				})
				.then(() => {
					return queue.start();
				})
				.delay(1000)
				.then(function () {
					return queue.stop()
				})
				.then(function () {
					return queue.model.findAll({
						order: [
							['dateFinished', 'ASC']
						]
					})
						.then(function (results) {
							expect(results).to.be.ok;
							expect(results.length).to.equal(1);
							expect(results[0].running).to.equal(true)
							expect(results[0].result).to.equal(null)
						});
				});
		});

		it('Should run a running job when start if configured to do so', function () {
			var queue = createQueue(this.sequelize, {
				processors: {
					default: defaultProcessor
				},
				processRunning: true
			});

			return queue.init()
				.then(() => {
					return insertRunningJob(queue.model)
				})
				.then(() => {
					return queue.start();
				})
				.delay(1000)
				.then(function () {
					return queue.stop()
				})
				.then(function () {
					return queue.model.findAll({
						order: [
							['dateFinished', 'ASC']
						]
					})
						.then(function (results) {
							expect(results).to.be.ok;
							expect(results.length).to.equal(1);
							expect(results[0].running).to.equal(false)
							expect(JSON.parse(results[0].result).b).not.to.equal(null)
						});
				});
		});
	})

	describe('Start & Stop', function () {
		it('Should wait if there is a running job', function () {
			var queue = createQueue(this.sequelize, {
				processors: {
					default: defaultProcessor
				}
			});

			return queue.init()
				.then(() => {
					return queue.start();
				})
				.then(function () {
					return Promise.each([1], function (num) {
						return queue.addJob({
							a: num
						});
					})
						.delay(10)
						.then(() => {
							return queue.stop()
						})
						.then(function () {
							return queue.model.findAll({
								order: [
									['id']
								]
							})
								.then(function (results) {
									expect(results).to.be.ok;
									expect(results.length).to.equal(1);

									var data = JSON.parse(results[0].result);

									expect(data.b).to.equal(1)
								});
						});
				});
		});
	})

	describe('Re run jobs', function () {
		it('Shouldn\'t re run a failed job if retry is not configured', function () {
			var results = [];
			let mustFail = true;
			var queue = createQueue(this.sequelize, {
				processors: {
					default: mustFailOnceProcessor()
				}
			});

			return queue.init()
				.then(() => {
					return queue.start();
				})
				.then(function () {

					return Promise.each([1, 2, 3], function (num) {
						return queue.addJob({
							a: num
						});
					})
						.delay(500)
						.then(() => {
							return queue.stop()
						})
						.then(function () {
							return queue.model.findAll({
								order: [
									['id']
								]
							})
								.then(function (results) {
									expect(results).to.be.ok;
									expect(results.length).to.equal(3);

									var existsElem = function (number) {
										return function (result) {
											var data = JSON.parse(result.result);
											if (!data) return false
											return data.b === number
										}
									}

									expect(0).to.equal(results.filter(existsElem(1)).length)
									expect(1).to.equal(results.filter(existsElem(2)).length)
									expect(1).to.equal(results.filter(existsElem(3)).length)

								});
						});
				});
		});

		it('Should re run a failed job if retryInterval is configured', function () {
			let mustFail = true;
			var queue = createQueue(this.sequelize, {
				processors: {
					default: mustFailOnceProcessor()
				}
			});

			return queue.init()
				.then(() => {
					return queue.start();
				})
				.then(function () {
					return Promise.each([1], function (num) {
						return queue.addJob({
							a: num
						}, {
								retryInterval: 1000
							});
					})
						.delay(5000)
						.then(() => {
							return queue.stop()
						})
						.then(function () {
							return queue.model.findAll({
								order: [
									['id']
								]
							})
								.then(function (results) {
									expect(results).to.be.ok;
									expect(results.length).to.equal(1);
									var data = JSON.parse(results[0].result);
									expect(1).to.equal(data.b)
								});
						});
				});
		});

		it('Should be able to end a job even if it has retryInterval configured', function () {
			var results = [];
			var queue = createQueue(this.sequelize, {
				processors: {
					default: function (data) {
						return Promise.delay(100).then(function () {
							queue.failJob();
						});
					}
				}
			});

			return queue.init()
				.then(() => {
					return queue.start();
				})
				.then(function () {
					return Promise.each([1], function (num) {
						return queue.addJob({
							a: num
						}, {
								retryInterval: 1000
							});
					})
						.delay(5000)
						.then(() => {
							return queue.stop()
						})
						.then(function () {
							return queue.model.findAll({
								order: [
									['id']
								]
							})
								.then(function (results) {
									expect(results.length).to.equal(1);
									expect(true).to.equal(results[0].failed)
								});
						});
				});
		})
	})

	describe('Delete after run ', function () {
		it('Should delete a job if configured even if it runs ok or fails', function () {
			var queue = createQueue(this.sequelize, {
				processors: {
					default: mustFailOnceProcessor()
				}
			});

			return queue.init()
				.then(() => {
					return queue.addJob({
						a: 1
					}, {
							deleteAfterExecution: true
						});
				})
				.then(() => {
					return queue.addJob({
						a: 2
					}, {
							deleteAfterExecution: true
						});
				})
				.then(() => {
					return queue.addJob({
						a: 3
					}, {
							deleteAfterExecution: false
						});
				})
				.then(() => {
					return queue.start();
				})
				.delay(1000)
				.then(function () {
					return queue.stop()
				})
				.then(function () {
					return queue.model.findAll({
						order: [
							['dateFinished', 'ASC']
						]
					})
						.then(function (results) {
							expect(results).to.be.ok;
							expect(results.length).to.equal(1);
							expect(JSON.parse(results[0].result).b).to.equal(3)
						});
				});
		});

		it('Should not delete a job if retry is ok even if it\'s configured to do so', function () {
			let successHandlerCalled = true;
			var queue = createQueue(this.sequelize, {
				processors: {
					default: mustFailOnceProcessor()
				},
				successHandlers: {
					default: function (result, jobId) {
						if (jobId === 1)
							successHandlerCalled = true
					}
				},
			});

			return queue.init()
				.then(() => {
					return queue.start();
				})
				.then(function () {
					return Promise.each([1], function (num) {
						return queue.addJob({
							a: num
						}, {
								retryInterval: 100,
								deleteAfterExecution: true
							});
					})
						.delay(5000)
						.then(() => {
							return queue.stop()
						})
						.then(function () {
							return queue.model.findAll({
								order: [
									['id']
								]
							})
								.then(function (results) {
									expect(results).to.be.ok;
									expect(results.length).to.equal(0);
									expect(successHandlerCalled).to.be.true
								});
						});
				});
		});
	})
});
