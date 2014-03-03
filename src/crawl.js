var fs = require("fs");

module.exports = function(casper) {
    var tmpDir = "/tmp/";

    /*
     * Events:
     * - error
     * - complete.error
     * - load.started
     * - load.failed
     * - load.finished
     * - page.error
     * - timeout
     * - url.changed
     */

    casper.on("error", function() {
        console.log("error", JSON.stringify(arguments));
        actionQueue.reattempt();
    });

    casper.on("complete.error", function() {
        console.log("complete.error");
        // TODO: Do we need to do anything here?
    });

    casper.on("page.error", function() {
        console.log("page.error", JSON.stringify(arguments));
        // TODO: Do we need to do anything here?
        actionQueue.reattempt();
    });

    var responses;

    casper.on("load.started", function() {
        if (utils.debug) {
            console.log("load.started");
        }

        responses = [];
    });

    casper.on("load.failed", function() {
        if (utils.debug) {
            console.log("load.failed");
        }
        actionQueue.reattempt();
    });

    casper.on("load.finished", function(status) {
        var response;

        responses.some(function(res) {
            if (!res.redirectURL) {
                response = res;
                return true;
            }
        });

        if (utils.debug) {
            console.log("load.finished", JSON.stringify(response));
        }

        if (response) {
            // Look for a status that doesn't represent an error
            if (response.status < 400 || response.status >= 600) {
                actionQueue.complete(true);
            } else {
                actionQueue.reattempt();
            }
        } else {
            actionQueue.log("No response!");
            actionQueue.reattempt();
        }
    });

    casper.on("resource.received", function(res) {
        if (utils.debug) {
            console.log("page.resource.received");
        }

        if (res.bodySize) {
            responses.push(res);
        }
    });

    casper.on("timeout", function() {
        if (utils.debug) {
            console.log("timeout");
        }
        actionQueue.reattempt();
    });

    casper.on("url.changed", function() {
        if (utils.debug) {
            console.log("url.changed");
        }
        actionQueue.current().undo = true;
    });

    var actionQueue = {
        _queue: [],

        delay: 5000,

        running: false,

        current: function() {
            return this._queue[0];
        },

        indent: "    ",
        indentLevel: 0,

        log: function(msg) {
            console.log(Array(this.indentLevel + 1).join(this.indent) + msg);
        },

        group: function(msg) {
            if (msg) {
                this.log(msg);
            }
            this.indentLevel += 1;
        },

        groupEnd: function() {
            this.indentLevel -= 1;
        },

        exec: function() {
            var options = this.current();

            if (!options || options.running) {
                return;
            }

            options.running = true;

            if (this.delay) {
                this.log("Delaying for: " + this.delay + "ms.");
            }

            setTimeout(function() {
                this.group(">> " + casper.getCurrentUrl());

                var args = (options.args || []).map(function(arg) {
                    return JSON.stringify(arg.path || arg);
                }).join(", ");

                this.log((options.type || options.action) +
                    "(" + args + ")");

                try {
                    if (typeof options.action === "function") {
                        options.action();
                    } else if (options.action === "back") {
                        casper.evaluate(function() {
                            window.history.back();
                        });
                    } else {
                        casper[options.action].apply(casper, options.args || []);
                    }

                    // Watch for URL change and page load
                    // If that fails then log as failure and re-attempt
                } catch(e) {
                    this.reattempt();
                }
            }.bind(this), this.delay || 1);
        },

        complete: function(pass) {
            var options = this._queue.shift();

            options.failed = !pass;
            options.running = false;

            this.log("Action complete: " +
                (pass ? "Success." : "Failure."));

            if (options.failed) {
                if (options.undo) {
                    this.log("Undoing page visit.");

                    options.running = false;
                    options.undo = false;

                    // Put the action back onto the queue
                    this._queue.unshift(options);

                    // Add on an additonal "undo" operation
                    this._queue.unshift({
                        action: "back"
                    });
                } else {
                    this.groupEnd();
                }
            } else {
                this.groupEnd();

                if (options.success) {
                    //console.log("Success: " + options.success.toString());
                    options.success();
                }
            }

            // Running the next action
            this.exec();
        },

        reattempt: function() {
            var options = this.current();

            options.attempts = (options.attempts || 0) + 1;

            if (options.attempts < 3) {
                // Log out re-attempt
                this.log("Error running command, re-attempt #" +
                    options.attempts);

                this.complete(false);
            } else {
                // Log out failure
                this.log("Action failed.");

                this.complete(false);
            }
        },

        queue: function(options) {
            // action, type, args, complete
            this._queue.push(options);
            this.exec();
        }
    };

    var utils = {
        init: function(scraper, options) {
            utils.options = options;
            utils.debug = options.debug;

            utils.queues = scraper.scrape.map(function(scraper) {
                return {
                    next: null,
                    visit: null,
                    data: {},
                    count: 0,
                    scraper: scraper
                };
            });

            casper.options.waitTimeout = 30000;

            actionQueue.delay = options.runtests ? 0 : 5000;

            casper.start();
            utils.nextQueueLevel(0);
        },

        handleQueueLevel: function(options) {
            if (utils.debug) {
                casper.log("Handling queue #" + utils.queuePos, "debug");
            }

            var curQueue = utils.curQueue;
            var scraper = curQueue.scraper;

            if (scraper.start && !curQueue.started) {
                curQueue.started = true;

                var runAgain = function() {
                    // Run the queue again, after starting
                    utils.nextQueueLevel(0);
                };

                if (utils.debug) {
                    casper.log("Loading start page...", "info");
                }

                if (typeof scraper.start === "string") {
                    actionQueue.queue({
                        action: "open",
                        args: [scraper.start],
                        success: runAgain
                    });
                } else if (typeof scraper.start === "function") {
                    actionQueue.queue({
                        type: "open",
                        action: scraper.start,
                        success: runAgain
                    });
                }

                return;
            }

            if (!options.back) {
                curQueue.count += 1;

                var indent = Array(utils.queuePos + 1).join("  ") + "[";
                if ("pos" in options) {
                    indent += (options.pos + 1) + "/";
                }
                if (utils.debug) {
                    casper.echo(indent + curQueue.count + "] " +
                        casper.getCurrentUrl());
                }
            }

            // Re-build data object from other queues
            curQueue.data = {};

            if (utils.queuePos > 0) {
                var prevData = utils.queues[utils.queuePos - 1].data;
                for (var data in prevData) {
                    curQueue.data[data] = prevData[data];
                }
            }

            // Run Handlers
            for (var handler in utils.handlers) {
                if (handler in scraper) {
                    utils.handlers[handler](scraper[handler]);
                }
            }

            // Run Action Handlers
            for (var action in utils.actions) {
                utils.actions[action](curQueue.data);
            }

            if (!options.back) {
                casper.emit("data", curQueue.data);
            }

            // TODO: Handle when next or visit is run and no results
            // come in. Should it be re-tried?

            var visitQueue = curQueue.visit;
            var nextQueue = curQueue.next;

            // Is there nothing to visit?
            if (curQueue.visitCount === 0) {
                // This shouldn't happen, it's likely a problem
                actionQueue.current().undo = true;
                actionQueue.reattempt();

            // Then run visit
            } else if (visitQueue && visitQueue.length > 0) {
                if (utils.debug) {
                    casper.log("Visiting page...", "info");
                }

                actionQueue.group();

                var visit = visitQueue.shift();
                // TODO: Get POS

                visit.success = function() {
                    // Step up to the next queue level
                    utils.nextQueueLevel(1, {pos: 0});
                };

                actionQueue.queue(visit);

            // Then run next page, in the same queue
            } else if (nextQueue && nextQueue.length > 0) {
                if (utils.debug) {
                    casper.log("Next queue page...", "info");
                }

                var next = nextQueue.shift();

                next.success = function(pos) {
                    // Run the same queue level again
                    utils.nextQueueLevel(0);
                };

                actionQueue.queue(next);

            // We're done!
            } else {
                if (utils.debug) {
                    casper.log("Completing queue #" + utils.queuePos, "debug");
                }

                if (utils.queuePos > 0) {
                    actionQueue.group();

                    actionQueue.queue({
                        action: "back",
                        success: function() {
                            actionQueue.groupEnd();
                            actionQueue.groupEnd();
                            utils.nextQueueLevel(-1, {back: true});
                        }
                    });

                } else {
                    // Go back to the previous queue level
                    actionQueue.groupEnd();
                    utils.nextQueueLevel(-1);
                    casper.emit("done");
                }
            }
        },

        nextQueueLevel: function(posDiff, options) {
            if (!utils.queuePos) {
                utils.queuePos = 0;
            }

            utils.queuePos += posDiff;
            utils.curQueue = utils.queues[utils.queuePos];

            // We're staying in the same queue, wipe out the
            // queues and continue.
            if (posDiff === 0) {
                utils.curQueue.visit = null;
                utils.curQueue.next = null;
            }

            if (!utils.curQueue) {
                if (utils.debug) {
                    if (utils.queuePos < 0) {
                        casper.emit("log", "Scrape complete.");
                    } else {
                        casper.emit("error", "Next queue level not found.");
                    }
                }
                return;
            }

            utils.handleQueueLevel(options || {});
        },

        clickQueue: function(selector) {
            // Generate a list of functions which, when executed
            // will visit the given URL and .then() the callback
            var num = casper.evaluate(function(selector) {
                return __utils__.findAll(selector).length;
            }, utils.selector(selector));

            var actions = [];

            for (var i = 0; i < num; i++) {
                actions.push({
                    action: "click",
                    args: [utils.selector(selector, i)]
                });
            }

            return actions;
        },

        urlQueue: function(urls) {
            // Generate a list of functions which, when executed
            // will visit the given URL and .then() the callback
            return urls.map(function(url) {
                return {
                    action: "open",
                    args: [url]
                };
            });
        },

        actions: {
            setQueuePos: function(data) {
                data.queuePos = utils.queuePos;
            },

            setURL: function(data) {
                data.url = casper.getCurrentUrl();
            },

            savePage: function(data) {
                // TODO: Handle alternative file types (such as JSON or XML?)
                var id = (new Date).getTime() + "" + Math.random();
                var tmpFile = tmpDir + id + ".html";
                fs.write(tmpFile, casper.getHTML(), "w");

                if (data) {
                    data.savedPage = tmpFile;
                }

                return tmpFile;
            }
        },

        handlers: {
            set: function(data) {
                for (var name in data) {
                    utils.curQueue.data[name] =
                        typeof data[name] === "function" ?
                            data[name](utils.curQueue.data) :
                            data[name];
                }
            },

            extract: function(selectors, origData) {
                var data = utils.curQueue.data;

                if (!data.extract) {
                    data.extract = [];
                }

                // Keep track of which queues need to be extracted from
                data.extract[utils.queuePos] = 1;
            },

            urls: function(urls) {
                if (utils.curQueue.next) {
                    return;
                }

                utils.curQueue.next = utils.urlQueue(urls);
            },

            next: function(selector) {
                if (utils.curQueue.next) {
                    return;
                }

                if (typeof selector === "string") {
                    utils.curQueue.next = utils.clickQueue(selector);

                } else if (typeof selector === "function") {
                    utils.curQueue.next = [{
                        type: "next",
                        action: selector
                    }];
                }
            },

            visit: function(selector) {
                if (utils.curQueue.visit) {
                    return;
                }

                if (typeof selector === "string") {
                    utils.curQueue.visit = utils.clickQueue(selector);

                } else if (typeof selector === "function") {
                    utils.curQueue.visit = [{
                        type: "visit",
                        action: selector
                    }];
                }

                utils.curQueue.visitCount = utils.curQueue.visit.length;
            }
        },

        searchURLs: function(opt) {
            var urls = [];
            var inc = opt.inc || 1;
            for (var i = opt.start || 1; i <= opt.end; i += inc) {
                urls.push(opt.url.replace(/%s/, i));
            }
            return utils.urlQueue(urls);
        },

        selector: function(selector, num) {
            return selector.indexOf("/") === 0 ?
                { type: "xpath", path: num != null ?
                    "(" + selector + ")[" + (num + 1) + "]" :
                    selector } :
                selector;
        }
    };

    return utils;
};