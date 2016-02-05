'use strict'

module.exports = function ( grunt ) {

	// Project configuration.
	grunt.initConfig ( {
		pkg: grunt.file.readJSON ( 'package.json' ),

		env: {
			sqlite: {
				DIALECT: 'sqlite'
			},
			postgres: {
				DIALECT: 'postgres'
			},
			mariadb : {
				DIALECT: 'mariadb'
			},
			mysql : {
				DIALECT: 'mysql'
			}
		},

		mocha_istanbul: {
			coverage: {
				src: 'test', // the folder, not the files
				options: {
					coverageFolder: 'coverage',
					mask: '**/*.test.js'
					//root: 'api/'
				}
			}
		}
	} )

	grunt.loadNpmTasks ( 'grunt-env' )
	grunt.loadNpmTasks ( 'grunt-mocha-istanbul' )

	// Default task(s).
	grunt.registerTask ( 'sqlite', [
		'env:sqlite', 'mocha_istanbul:coverage'
	] )

	grunt.registerTask ( 'postgres', [
		'env:postgres', 'mocha_istanbul:coverage'
	] )

	grunt.registerTask ( 'mariadb', [
		'env:mariadb', 'mocha_istanbul:coverage'
	] )

	grunt.registerTask ( 'mysql', [
		'env:mysql', 'mocha_istanbul:coverage'
	] )

	grunt.registerTask ('default', ['sqlite'])

	grunt.registerTask ('all', ['sqlite', 'postgres', 'mariadb', 'mysql'])

}
