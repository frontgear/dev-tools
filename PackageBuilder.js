/*!
 * Copyright (c) @crzyj
 *
 * Released under the MIT license:
 * https://opensource.org/licenses/MIT
 */

var fs = require("fs");
var mkdirp = require("mkdirp");
var ncp = require("ncp");
var os = require("os");
var path = require("path");
var rimraf = require("rimraf");

var Class = require("@frontgear/lang-dev/src/Class");
var ObjectUtil = require("@frontgear/lang-dev/src/ObjectUtil");

module.exports = Class("@frontgear/dev-tools/PackageBuilder", Object, function(PackageBuilder, base)
{

	// Private Static Constants

	var _R_JS_EXT = /\.js$/i;
	var _R_FILE_PATH = /^file\:/;
	var _R_BACKSLASH = /\\/g;
	var _R_NEWLINE = /\r\n|\r|\n/g;
	var _R_COPYRIGHT_HEADER = /^\s*(\/\*[\s\S]*?copyright[\s\S]*?\*\/)\s*/i;
	var _R_NEWLINE_TRIM = /^(?:\s*[\r\n])+|(?:[\r\n]\s*)+$/g;
	var _R_INDENT = /(^|\r\n|\r|\n)([^\r\n])/g;

	// Private Static Methods

	var _alphabeticComparator = function(str1, str2)
	{
		var low1 = str1.toLowerCase();
		var low2 = str2.toLowerCase();
		if (low1 < low2)
			return -1;
		if (low1 > low2)
			return 1;
		if (str1 < str2)
			return -1;
		if (str1 > str2)
			return 1;
		return 0;
	};

	// Private Properties

	this._module = null;
	this._modulePath = "";
	this._packageName = "";
	this._packagePath = "";
	this._sourcePath = "src";
	this._outputPath = "lib";
	this._copyrightHeaders = null;

	// Constructor

	this.constructor = function(module)
	{
		if (module == null)
			throw new Error("Parameter module must be non-null.");
		if ((typeof module !== "object") || (typeof module.filename !== "string") || (typeof module.require !== "function"))
			throw new Error("Parameter module must be a module object.");

		this._module = module;
		this._modulePath = path.resolve(module.filename, "../");
	};

	// Public Accessor Methods

	this.packageName = function(value)
	{
		if (!arguments.length)
			return this._packageName;

		if ((value != null) && !Class.isString(value))
			throw new Error("Parameter packageName must be of type String.");

		this._packageName = value || "";

		return this;
	};

	this.packagePath = function(value)
	{
		if (!arguments.length)
			return path.resolve(this._modulePath, this._packagePath);

		if ((value != null) && !Class.isString(value))
			throw new Error("Parameter packagePath must be of type String.");

		this._packagePath = value || "";

		return this;
	};

	this.sourcePath = function(value)
	{
		if (!arguments.length)
			return path.resolve(this._modulePath, this._packagePath, this._sourcePath);

		if ((value != null) && !Class.isString(value))
			throw new Error("Parameter sourcePath must be of type String.");

		this._sourcePath = value || "";

		return this;
	};

	this.outputPath = function(value)
	{
		if (!arguments.length)
			return path.resolve(this._modulePath, this._packagePath, this._outputPath);

		if ((value != null) && !Class.isString(value))
			throw new Error("Parameter outputPath must be of type String.");

		this._outputPath = value || "";

		return this;
	};

	// Public Methods

	this.build = function()
	{
		if (!this._packagePath)
			throw new Error("Must set packagePath.");
		if (!this._sourcePath)
			throw new Error("Must set sourcePath.");
		if (!this._outputPath)
			throw new Error("Must set outputPath.");

		if (this._packageName)
			console.log("Building package \"" + this._packageName + "\" ...\n");
		else
			console.log("Building package ...\n");

		console.log("    source: " + this.sourcePath());
		console.log("    output: " + this.outputPath());

		var self = this;

		var steps =
		[
			this._clean,
			this._prepare,
			this._transpileSrc,
			this._createIndexJS,
			this._createPackageJSON,
			this._copyReadme,
			this._copyLicense
		];

		var next = function(err)
		{
			if (err)
				throw err;

			var step = steps.shift();
			if (step)
				step.call(self, next);
			else
				console.log("\nDone.");
		};

		next();

		return this;
	};

	// Private Methods

	this._clean = function(callback)
	{
		// clear dst directory
		rimraf(path.resolve(this.outputPath(), "./*"), callback);
	};

	this._prepare = function(callback)
	{
		// create dst directory if it doesn't exist
		mkdirp(this.outputPath(), callback);
	};

	this._transpileSrc = function(callback)
	{
		// transpile files from sourcePath to outputPath

		this._copyrightHeaders = [];

		console.log("\n    Transpiling source files ...\n");

		var self = this;
		var srcPath = this.sourcePath();
		var dstPath = this.outputPath();
		var srcFilePath;
		var dstFilePath;
		var fileList;

		var readFile = function(err, files)
		{
			if (err)
			{
				callback(err);
				return;
			}

			if (!fileList)
				fileList = files.sort(_alphabeticComparator);

			if (fileList.length === 0)
			{
				console.log("\n    Done.");
				callback();
				return;
			};

			var srcFileName = fileList.shift();
			var dstFileName = srcFileName;
			if (!_R_JS_EXT.test(dstFileName))
				dstFileName += ".js";

			srcFilePath = path.resolve(srcPath, srcFileName);
			dstFilePath = path.resolve(dstPath, dstFileName);

			console.log("        " + srcFileName + " -> " + dstFileName);

			fs.readFile(srcFilePath, "utf8", writeFile);
		};

		var writeFile = function(err, source)
		{
			if (err)
			{
				callback(err);
				return;
			}

			if (typeof source === "string")
				source = self._umdWrap(source);

			fs.writeFile(dstFilePath, source, readFile);
		};

		fs.readdir(srcPath, readFile);
	};

	this._createIndexJS = function(callback)
	{
		// create index.js file, including version from package.json

		console.log("\n    Creating index.js");

		var self = this;
		var srcPath = path.resolve(this.packagePath(), "./package.json");
		var dstPath = path.resolve(this.outputPath(), "./index.js");
		var packageJSON = require(srcPath);
		var version = packageJSON.version;

		var copyrightHeader = null;
		var copyrightHeaders = this._copyrightHeaders;
		if (copyrightHeaders && (copyrightHeaders.length > 0))
		{
			copyrightHeader = copyrightHeaders[0];
			for (var i = 1, l = copyrightHeaders.length; i < l; i++)
			{
				if (copyrightHeaders[i] !== copyrightHeader)
				{
					copyrightHeader = null;
					break;
				}
			}
		}

		fs.readdir(this.sourcePath(), function(err, files)
		{
			if (err)
			{
				callback(err);
				return;
			}

			files.sort(_alphabeticComparator);

			var lineBuffer = [];
			if (copyrightHeader)
			{
				lineBuffer.push(copyrightHeader);
				lineBuffer.push('');
			}
			lineBuffer.push('module.exports =');
			lineBuffer.push('{');
			lineBuffer.push('\t"version": ' + JSON.stringify(version));
			for (var file, i = 0, l = files.length; i < l; i++)
			{
				file = files[i];
				if (_R_JS_EXT.test(file))
				{
					file = file.replace(_R_JS_EXT, '');
					lineBuffer[lineBuffer.length - 1] += ',';
					lineBuffer.push('\t' + JSON.stringify(file) + ': require(' + JSON.stringify('./' + file) + ')');
				}
			}
			lineBuffer.push('};');

			var source = self._umdWrap(lineBuffer.join(os.EOL));

			fs.writeFile(dstPath, source, callback);
		});
	};

	this._createPackageJSON = function(callback)
	{
		// create package.json file
		// include name, version, description, author, license,
		// repository, and dependencies copied from root package.json
		// add "main": "index.js" before dependencies

		console.log("\n    Creating package.json");

		var fileName = "./package.json";
		var srcPath = path.resolve(this.packagePath(), fileName);
		var dstPath = path.resolve(this.outputPath(), fileName);

		var srcJSON = require(srcPath);
		var dstJSON = {};

		var keys =
		[
			"name",
			"version",
			"description",
			"author",
			"license",
			"repository",
			"main",
			"dependencies"
		];

		for (var key, value, i = 0, l = keys.length; i < l; i++)
		{
			key = keys[i];
			value = srcJSON[key];
			if (key === "name")
				dstJSON[key] = this._packageName || value;
			else if (key === "main")
				dstJSON[key] = "./index.js";
			else if ((key === "dependencies") && value)
				dstJSON[key] = this._normalizeDependencies(value, this.packagePath(), this.outputPath());
			else if (value)
				dstJSON[key] = value;
		}

		var source = JSON.stringify(dstJSON, null, "  ");
		source = source.replace(_R_NEWLINE, os.EOL) + os.EOL;

		fs.writeFile(dstPath, source, callback);
	};

	this._copyReadme = function(callback)
	{
		// copy README.md

		console.log("\n    Copying README.md");

		var fileName = "./README.md";
		var srcPath = path.resolve(this.packagePath(), fileName);
		var dstPath = path.resolve(this.outputPath(), fileName);
		if (!fs.existsSync(srcPath))
			callback();
		else
			ncp(srcPath, dstPath, callback);
	};

	this._copyLicense = function(callback)
	{
		// copy LICENSE

		console.log("\n    Copying LICENSE");

		var fileName = "./LICENSE";
		var srcPath = path.resolve(this.packagePath(), fileName);
		var dstPath = path.resolve(this.outputPath(), fileName);
		if (!fs.existsSync(srcPath))
			callback();
		else
			ncp(srcPath, dstPath, callback);
	};

	this._normalizeDependencies = function(dependencies, srcPath, dstPath)
	{
		dependencies = ObjectUtil.extend({}, dependencies);

		var keys = ObjectUtil.keys(dependencies);
		for (var key, value, i = 0, l = keys.length; i < l; i++)
		{
			key = keys[i];
			value = dependencies[key];
			if (_R_FILE_PATH.test(value))
			{
				value = value.replace(_R_FILE_PATH, "");
				value = path.resolve(srcPath, value);
				value = path.relative(dstPath, value);
				value = value.replace(_R_BACKSLASH, "/");
				dependencies[key] = "file:" + value;
			}
		}

		return dependencies;
	};

	this._umdWrap = function(source)
	{
		var lineBuffer = [];

		// extract copyright header so it remains at the top of the wrapped source
		source = source.replace(_R_COPYRIGHT_HEADER, function(match, copyrightHeader)
		{
			lineBuffer.push(copyrightHeader);
			lineBuffer.push('');
			return '';
		});

		// track copyright header for use in index.js file
		if (this._copyrightHeaders)
			this._copyrightHeaders.push((lineBuffer.length > 0) ? lineBuffer[0] : '');

		// trim leading/trailing newlines and indent
		source = source.replace(_R_NEWLINE_TRIM, '').replace(_R_INDENT, '$1\t$2');

		// wrap with umd boilerplate
		lineBuffer.push('(function(define) { define(function(require, exports, module) {');
		lineBuffer.push('');
		lineBuffer.push(source);
		lineBuffer.push('');
		lineBuffer.push('}); })((typeof define === "function") ? define : function(factory) { factory(require, exports, module); });');

		return lineBuffer.join(os.EOL) + os.EOL;
	};

});
