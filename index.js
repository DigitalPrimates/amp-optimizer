module.exports = amp;

var _ = require('lodash');
var fs = require('fs');
var acorn = require("acorn");
var Promise = require('promise');
var readDir = denodeify(fs, fs.readdir);
var readFile = denodeify(fs, fs.readFile);
var parseArgs = require('minimist');

function denodeify(scope, fn) {
    return function () {
        var args = Array.prototype.slice.call(arguments);
        return new Promise(function (resolve, reject) {
            var converter = function (err, res) {
                if (err) reject(err);
                else resolve(res);
            };

            args.push(converter);
            fn.apply(scope, args);
        });

    }
}
function logIt(message) {
    console.log(message);
}

function getContents(root) {
    return readDir(root).then(function (data) {

        return scanDirectory(root, data);
    }, logIt);
}

function scanDirectory(root, candidateList) {
    function addRoot(item) {
        return root + '\\' + item;
    }

    var jsFiles = candidateList.filter(
        function (file) {
            return file.indexOf('.js') != -1
        }).map(addRoot);

    var interestingDirectories = candidateList.filter(
        function (file) {
            return file.indexOf('.') == -1
        }).map(addRoot);

    return Promise.all(
        _.map(interestingDirectories, function (dir) {
            return getContents(dir);
        }).concat(
            Promise.resolve(jsFiles))
    );
}

function parseFiles(fileList, namespace) {

    function parseAST(contents, namespace) {
        function nodeType(type) {
            return function (node) {
                return node.type && node.type == type;
            }
        }

        function deriveObjectName(node) {
            if (!node.object) {
                return node.name;
            }

            return deriveObjectName(node.object) + '.' + node.property.name;
        }

        var ast = acorn.parse(contents);

        var dependencies =
            _(ast.body).filter(nodeType('VariableDeclaration')).flatMap(function (node) {
                return node.declarations.filter(nodeType('VariableDeclarator'));
            }).filter(function (node) {
                return node.id.name == namespace;
            }).flatMap(function (node) {
                return node.init.arguments.filter(nodeType('MemberExpression'));
            }).flatMap(function (node) {
                return deriveObjectName(node);
            }).value();

        var declarations =
            _(ast.body).filter(nodeType('VariableDeclaration')).flatMap(function (node) {
                return node.declarations.filter(nodeType('VariableDeclarator'));
            }).filter(function (node) {
                return node.id.name == namespace;
            }).flatMap(function (node) {
                return node.init.callee;
            }).filter(nodeType('FunctionExpression')).flatMap(function (node) {
                return node.body.body.filter(nodeType('ExpressionStatement'));
            }).filter(function (node) {
                return node.expression.type == 'AssignmentExpression' && node.expression.left.type == 'MemberExpression';
            }).flatMap(function (node) {
                return deriveObjectName(node.expression.left);
            }).flatMap(function (property) {
                return property.replace('module', namespace);
            }).value();

        var setters = [];

        return {dependencies: dependencies, declarations: declarations, setters: setters};
    }

    return Promise.all(
        fileList.map(
            function (file) {
                return readFile(file, 'utf8').then(
                    function (contents) {
                        var parsed = parseAST(contents, namespace);
                        return Promise.resolve({
                            file: file,
                            contents: contents,
                            dependencies: parsed.dependencies,
                            declarations: parsed.declarations
                        });
                    }
                )
            }
        )
    );
}

function containsAll(exportList, dependencies) {
    var exported = _.flatMap(exportList, function (item) {
        return item.declarations;
    });

    var resolved = _.keyBy(exported);

    var remainingDependencies = _.filter(dependencies, function (dep) {
        return !resolved[dep];
    });

    return (remainingDependencies.length == 0);
}

function buildList(files) {

    //in theory, this could be an n^2 operation... it wont be due to previous sorts and others, but this will ensure
    //we catch circular references
    var limit = files.length * 2;
    var attempts = 0;
    var exportList = [];

    while (attempts < limit) {
        attempts++;

        var exported = _.keyBy(exportList, function (o) {
            return o.file
        });
        var remainingFiles = _.filter(files, function (o) {
            return !exported[o.file];
        });

        if (!remainingFiles.length) {
            break;
        }

        for (var i = 0; i < remainingFiles.length; i++) {
            if (containsAll(exportList, remainingFiles[i].dependencies)) {
                exportList.push(remainingFiles[i]);
                break;
            }
        }
    }

    return exportList;
}

function writeOutputFile(organizedFileList, outputFile) {
    fs.writeFile(outputFile, _.map(organizedFileList, 'contents'), function (err) {
        if (err) {
            return console.log(err);
        }

        console.log("The file was saved!");
    });
}

function amp() {
    const argv = parseArgs(process.argv.slice(2), {default: {output: 'output.js'}});

    var source = argv.source;
    var outputFile = argv.output;
    var namespace = argv.namespace;

    const printHelp = !( source && namespace );

    if (( printHelp )) {
        //print the command line help and get out of here
        console.log('amp-optimizer --source=[path_to_src] --namespace=[module_namespace] [--output=path_to_output]');
        process.exit();
    }

    console.log('Parsing ' + source + ' for ' + namespace + ' entries and writing to ' + outputFile);

    getContents(source).then(_.flattenDeep).then(function (files) {
        return parseFiles(files, namespace)
    }, logIt).then(buildList, logIt).then(function (list) {
        return writeOutputFile(list, outputFile)
    }, logIt);
}
