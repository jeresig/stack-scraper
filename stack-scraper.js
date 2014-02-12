var fs = require("fs");

var _ = require("lodash");
var async = require("async");
var Spooky = require("spooky");

var fileUtils = require("./utils/file.js");
var extractUtils = require("./utils/extract.js");

// TODO: Where is the id being generated?
//       Shouldn't it be used as _id?

var StackScraper = function(options) {
    this.options = options;
    this.extractQueue = [];

    if (!this.options.model) {
        throw "StackScraper: Please provide a model.";
    }

    if (!this.options.source) {
        throw "StackScraper: Please provide a source name.";
    }

    if (!this.options.scraperFile) {
        throw "StackScraper: Please provide a path to a scraper file.";
    }

    if (!this.options.htmlDir) {
        throw "StackScraper: Please provide a path to store the HTML files in.";
    }

    if (!this.options.xmlDir) {
        throw "StackScraper: Please provide a path to store the XML files in.";
    }

    this.loadScraperFile();
};

StackScraper.prototype = {
    pageSettings: {
        loadImages: false,
        javascriptEnabled: true,
        loadPlugins: false,
        timeout: 30000,
        stepTimeout: 30000,
        waitTimeout: 30000
    },

    mirrorExclude: [".jpg", ".jpeg", ".png", ".gif"],

    loadScraperFile: function() {
        this.scraper = require(this.options.scraperFile)();
    },

    download: function(callback) {
        console.log("Starting CasperJS...");

        var processQueue = async.queue(function(data, next) {
            // If the dummy boolean is hit then we're all done processing!
            if (data === true) {
                next();
                callback();

            } else {
                // Otherwise we need to keep processing the data
                this.processData(data, next);
            }
        }.bind(this), 1);

        var options = _.clone(this.options);

        var settings = _.extend(this.pageSettings,
            this.options.pageSettings,
            this.options.scraper.pageSettings);

        var spooky = new Spooky({
            exec: {
                file: __dirName + "/casper-bootstrap.js",
                options: options
            },
            casper: {
                logLevel: options.debug ? "debug" : "error",
                verbose: true,
                pageSettings: settings
            }
        });

        spooky.on("error", function(e) {
            console.error(e);
        });

        spooky.on("console", function(line) {
            console.log(line);
        });

        spooky.on("log", function(log) {
            if (args.debug) {
                console.log(log.message.replace(/ \- .*/, ""));
            }
        });

        spooky.on("data", function(data) {
            processQueue.push(data);
        });

        spooky.on("done", function() {
            // Push on a dummy boolean to know when we've hit the
            // end of the queue
            processQueue.push(true);
        });
    },

    scrape: function(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, this.processDoc.bind(this), callback);
        });
    },

    scrapeDirectory: function(dir, callback) {
        var exclude = this.mirrorExclude.concat(
            this.options.mirrorExclude || []);
        var queue = [];

        fileUtils.walkTree(function(file) {
            queue.push({
                savedPage: file,
                queuePos: 0,
                extract: [1]
            });
        }, function() {
            async.eachLimit(queue, 1, processData.bind(this), callback);
        });
    },

    /*
     * process(filter, callback)
     *
     * Finds all the scraped entries and processes the data according to
     * the processing rules.
     */
    process: function(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, function(data, callback) {
                this.postProcess(data, function() {
                    this.dbUpdate(data, {}, callback);
                }.bind(this));
            }.bind(this), callback);
        });
    },

    processDoc: function(data, callback) {
        var datas = [data];

        this.options.scraper.scrape.forEach(function(queueLevel, queuePos) {
            datas = _.flatten(datas.map(function(data) {
                var pageID = data && data.extract && data.extract[queuePos];

                if (!pageID) {
                    return [data];
                }

                if (typeof queueLevel.extract === "function") {
                    extractUtils.extract(null, queueLevel.extract, data);
                    return [data];
                }

                var xmlFile = xmlDir + pageID + ".xml";

                fileUtils.readXMLFile(xmlFile, function(err, xmlDoc) {
                    if (queueLevel.root) {
                        var roots = xmlDoc.find(queueLevel.root);
                        return roots.map(function(root) {
                            var clonedData = _.cloneDeep(data);
                            extractUtils.extract(root, queueLevel.extract,
                                clonedData);
                            return clonedData;
                        });
                    } else {
                        extractUtils.extract(xmlDoc, queueLevel.extract, data);
                        return [data];
                    }
                });
            }));
        });

        async.forEach(datas, function(data, callback) {
            if (!data || this.options.scraper.accept &&
                    !this.options.scraper.accept(data)) {
                return callback();
            }

            this.postProcess(data, function(err, datas) {
                if (err) {
                    return callback(err);
                }

                async.forEach(datas, this.saveData.bind(this), callback);
            }.bind(this));
        }.bind(this), function(err, data) {
            callback(err, data);
        });
    },

    processData: function(data, callback) {
        var fns = _.values(this.processors);
        async.reduce(fns, [data], function(datas, handler, callback) {
            handler.call(this, datas, callback);
        }.bind(this), function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.forEach(datas, this.processDoc.bind(this), callback);
        }.bind(this));
    },

    postProcess: function(data, callback) {
        var fns = _.keys(this.options.postProcessors || {});

        async.reduce(fns, [data], function(datas, processorName, callback) {
            var processor = postProcessors[processorName];
            async.map(datas, function(data, callback) {
                if (!data[processorName]) {
                    return callback(null, data);
                }
                processor(data, this.options.scraper, callback);
            }.bind(this), function(err, datas) {
                callback(err, _.flatten(datas));
            });
        }.bind(this), callback);
    },

    saveData: function(data, callback) {
        if (!data._id) {
            this.dbSave(data, callback);
            return;
        }

        this.dbFindById(data._id, function(err, item) {
            if (err) {
                return callback(err);
            }

            this.dbUpdate(item, data, function(err, data) {
                callback(err, data);
            });
        }.bind(this));
    },

    processors: {
        savedPage: function(datas, callback) {
            var encoding = this.options.scraper.encoding;

            async.map(datas, function(data, callback) {
                if (!data.savedPage) {
                    return callback(null, data);
                }

                fileUtils.md5File(data.savedPage, function(md5) {
                    var htmlFile = htmlDir + name + ".html";
                    var xmlFile = xmlDir + name + ".xml";

                    data.pageID = md5;

                    fileUtils.condCopyFile(data.savedPage, htmlFile,
                        function() {
                            fileUtils.convertXML(htmlFile, xmlFile, encoding,
                                function(err) {
                                    callback(err, data);
                                });
                        });
                });
            }, callback);
        },

        extract: function(datas, callback) {
            var extractQueue = this.extractQueue;

            callback(null, datas.map(function(data) {
                if (!data.extract || !data.extract[data.queuePos]) {
                    delete data.extract;
                    delete data.extracted;
                    delete data.queuePos;
                    return data;
                }

                // Make sure the queue is as least as long as it should be
                for (var i = extractQueue.length; i < data.queuePos; i++) {
                    extractQueue[i] = null;
                }

                // Inject into position and delete everything after this
                // point in the queue.
                extractQueue.splice(data.queuePos, extractQueue.length,
                    data.pageID);
                data.extract = _.map(extractQueue.slice(0), function(item) {
                    return item || "";
                });
                this.setDataExtracted(data);

                delete data.queuePos;

                return data;
            }));
        }
    },

    setDataSource: function(data) {
        var sourceName = this.options.sourceName || "source";
        data[sourceName] = data[sourceName] || this.options.source;
    },

    setDataModified: function(data) {
        data.modified = Date.now();
    },

    setDataExtracted: function(data) {
        data.extracted = true;
    },

    dbFind: function(filter, callback) {
        this.options.model.find(filter).exec(callback);
    },

    dbFindById: function(id, callback) {
        this.options.model.findById(id, callback);
    },

    dbSave: function(data, callback) {
        this.setDataSource(data);
        this.setDataModified(data);

        this.options.model.create(data, function(err, item) {
            if (!err) {
                console.log("Saved (%s) %s", source,
                    args.debug ? JSON.stringify(item) : item.imageName);
            }

            callback(err);
        });
    },

    dbUpdate: function(item, data, callback) {
        if (args.debug) {
            console.log("Updating...");
        }

        _.extend(item, data);

        var delta = item.$__delta();

        if (delta) {
            this.setDataSource(item);
            this.setDataModified(item);

            item.save(function(err) {
                if (!err) {
                    console.log("Updated (%s/%s) %s", source, item._id,
                        JSON.stringify(delta));
                }

                callback(err);
            });

        } else {
            console.log("No Change (%s/%s) %s", source, item._id,
                args.debugs ? JSON.stringify(item) : "");

            process.nextTick(callback);
        }
    }
};

module.exports = StackScraper;