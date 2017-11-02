'use strict';
const fs = require("fs");

module.exports = function(casper) {
    const tmpDir = "/tmp/";

    casper.on("error", () => {
        console.log("error", JSON.stringify(arguments));
        actionQueue.reattempt();
    });

    casper.on("page.error", () => {
        console.log("page.error", JSON.stringify(arguments));
        // TODO: Do we need to do anything here?
        actionQueue.reattempt();
    });

    let responses;

    casper.on("load.started", () => {
        if (utils.debug) {
            console.log("load.started");
        }

        if (actionQueue.requestStarted) {
            responses = [];
        }
    });

    casper.on("load.finished", status => {
        if (!actionQueue.requestStarted) {
            return;
        }

        actionQueue.requestStarted = false;

        let response;

        responses.some(res => {
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

    casper.on("resource.received", res => {
        if (utils.debug) {
            console.log("page.resource.received");
        }

        if (res.bodySize) {
            responses.push(res);
        }
    });

    casper.on("timeout", () => {
        if (utils.debug) {
            console.log("timeout");
        }
        actionQueue.reattempt();
    });

    casper.on("url.changed", () => {
        if (utils.debug) {
            console.log("url.changed");
        }
        actionQueue.current().undo = true;
    });

    const actionQueue = {
        _queue: [],
        delay: 5000,
        running: false,

        current() {
            return this._queue[0];
        },

        indent: "    ",
        indentLevel: 0,

        log(msg) {
            console.log(Array(this.indentLevel + 1).join(this.indent) + msg);
        },

        group(msg) {
            if (msg) {
                this.log(msg);
            }
            this.indentLevel += 1;
        },

        groupEnd() {
            this.indentLevel -= 1;
        },

        exec() {
            const options = this.current();

            if (!options || options.running) {
                return;
            }

            options.startTime = options.startTime || (new Date).getTime();
            options.running = true;

            let delay = this.delay || 1;

            // No need to delay if we're not doing anything
            if (utils.queueOptions.skip === true) {
                delay = 1;
            }

            if (delay > 1) {
                this.log(`Delaying for: ${delay}ms.`);
            }

            setTimeout(() => {
                this.group(`>> ${casper.getCurrentUrl()}`);

                const args = (options.args || [])
                    .map(arg => JSON.stringify(arg.path || arg))
                    .join(", ");

                if (utils.queueOptions.skip === true) {
                    this.log(`${options.type || options.action}(Skipping)`);
                    actionQueue.complete(true);
                    return;
                }

                this.log(`${options.type || options.action}(${args})`);

                try {
                    this.requestStarted = true;

                    if (typeof options.action === "function") {
                        options.action();
                    } else if (options.action === "back") {
                        casper.evaluate(() => {
                            window.history.back();
                        });
                    } else {
                        const args = options.args || [];
                        casper[options.action](...args);
                    }

                    // Watch for URL change and page load
                    // If that fails then log as failure and re-attempt
                } catch (e) {
                    this.reattempt();
                }
            }, delay);
        },

        complete(pass) {
            const options = this._queue.shift();

            options.failed = !pass;
            options.running = false;
            options.level = utils.queuePos;
            options.levelOptions = utils.queueOptions;

            this.log(`Action complete: ${pass ? "Success." : "Failure."}`);

            if (options.failed) {
                if (options.undo) {
                    this.log("Undoing page visit.");

                    options.running = false;
                    options.undo = false;

                    // Put the action back onto the queue
                    this._queue.unshift(options);

                    // Add on an additonal "undo" operation
                    this._queue.unshift({
                        action: "back",
                        log: false,
                    });
                } else {
                    this.groupEnd();
                }
            } else {
                options.endTime = (new Date).getTime();

                for (const prop in utils.curQueue.data) {
                    options[prop] = utils.curQueue.data[prop];
                }

                if (options.log !== false && utils.queueOptions.log !== false) {
                    casper.emit("action", options);
                }

                this.groupEnd();

                if (options.success) {
                    options.success();
                }
            }

            // Running the next action
            this.exec();
        },

        reattempt() {
            const options = this.current();

            options.attempts = (options.attempts || 0) + 1;

            if (options.attempts < 3) {
                // Log out re-attempt
                this.log(`Error running command, re-attempt ` +
                    `#${options.attempts}`);

                this.complete(false);
            } else {
                // Log out failure
                this.log("Action failed.");

                this.complete(false);
            }
        },

        queue(options) {
            // action, type, args, complete
            this._queue.push(options);
            this.exec();
        },
    };

    const utils = {
        init(scraper, options) {
            utils.options = options;
            utils.debug = options.debug;

            utils.queues = scraper.scrape.map(scraper => ({
                next: null,
                visit: null,
                data: {},
                count: 0,
                scraper,
            }));

            casper.options.waitTimeout = 30000;

            actionQueue.delay = options.runtests ? 0 : 5000;

            casper.start();

            utils.nextQueueLevel(0);
        },

        handleQueueLevel(options) {
            utils.queueOptions = options;

            if (utils.debug) {
                casper.log(`Handling queue #${utils.queuePos}`, "debug");
            }

            const curQueue = utils.curQueue;
            const scraper = curQueue.scraper;

            if (scraper.start && !curQueue.started) {
                curQueue.started = true;

                const runAgain = function() {
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
                        success: runAgain,
                    });
                } else if (typeof scraper.start === "function") {
                    actionQueue.queue({
                        type: "open",
                        action: scraper.start,
                        success: runAgain,
                    });
                }

                return;
            }

            if (!options.back) {
                curQueue.count += 1;

                let indent = `${Array(utils.queuePos + 1).join("  ")}[`;
                if ("pos" in options) {
                    indent += `${options.pos + 1}/`;
                }
                if (utils.debug) {
                    casper.echo(`${indent + curQueue.count}] ` +
                        `${casper.getCurrentUrl()}`);
                }
            }

            // Re-build data object from other queues
            curQueue.data = {};

            if (utils.queuePos > 0) {
                const prevData = utils.queues[utils.queuePos - 1].data;
                for (const data in prevData) {
                    curQueue.data[data] = prevData[data];
                }
            }

            // Run Handlers
            for (const handler in utils.handlers) {
                if (handler in scraper) {
                    utils.handlers[handler](scraper[handler]);
                }
            }

            // Run Action Handlers
            for (const action in utils.actions) {
                utils.actions[action](curQueue.data);
            }

            // TODO: Handle when next or visit is run and no results
            // come in. Should it be re-tried?

            const visitQueue = curQueue.visit;
            const nextQueue = curQueue.next;

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

                const visit = visitQueue.shift();
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

                const next = nextQueue.shift();

                next.success = function(pos) {
                    // Run the same queue level again
                    utils.nextQueueLevel(0);
                };

                actionQueue.queue(next);

            // We're done!
            } else {
                if (utils.debug) {
                    casper.log(`Completing queue #${utils.queuePos}`, "debug");
                }

                if (utils.queuePos > 0) {
                    actionQueue.group();

                    actionQueue.queue({
                        action: "back",

                        success() {
                            actionQueue.groupEnd();
                            actionQueue.groupEnd();
                            utils.nextQueueLevel(-1, {back: true});
                        },
                    });

                } else {
                    // Go back to the previous queue level
                    actionQueue.groupEnd();
                    utils.nextQueueLevel(-1);
                    casper.emit("done");
                }
            }
        },

        nextQueueLevel(posDiff, options) {
            if (!utils.queuePos) {
                utils.queuePos = 0;
            }

            // Support resuming from an existing queue of actions
            if (utils.replayQueueLevel()) {
                return;
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

        replayQueueLevel() {
            const queue = utils.options.queue;

            if (!queue || queue.length === 0) {
                return false;
            }

            const oldQueue = utils.curQueue;
            const levelCall = queue.shift();
            utils.queuePos = levelCall.level;
            utils.curQueue = utils.queues[utils.queuePos];

            // We're staying in the same queue, wipe out the
            // queues and continue.
            if (oldQueue === utils.curQueue) {
                utils.curQueue.visit = null;
                utils.curQueue.next = null;
            }

            utils.handleQueueLevel(levelCall.options);
            return true;
        },

        clickQueue(selector) {
            // Generate a list of functions which, when executed
            // will visit the given URL and .then() the callback
            const num = casper.evaluate(
                selector => __utils__.findAll(selector).length,
                utils.selector(selector)
            );

            const actions = [];

            for (let i = 0; i < num; i++) {
                actions.push({
                    action: "click",
                    args: [utils.selector(selector, i)],
                });
            }

            return actions;
        },

        urlQueue(urls) {
            // Generate a list of functions which, when executed
            // will visit the given URL and .then() the callback
            return urls.map(url => ({
                action: "open",
                args: [url],
            }));
        },

        actions: {
            setQueuePos(data) {
                data.queuePos = utils.queuePos;
            },

            setURL(data) {
                data.url = casper.getCurrentUrl();
            },

            savePage(data) {
                // TODO: Handle alternative file types (such as JSON or XML?)
                const id = `${(new Date).getTime()}${Math.random()}`;
                const tmpFile = `${tmpDir + id}.html`;
                fs.write(tmpFile, casper.getHTML(), "w");

                if (data) {
                    data.savedPage = tmpFile;
                }

                return tmpFile;
            },
        },

        handlers: {
            set(data) {
                for (const name in data) {
                    utils.curQueue.data[name] =
                        typeof data[name] === "function" ?
                            data[name](utils.curQueue.data) :
                            data[name];
                }
            },

            extract(selectors, origData) {
                const data = utils.curQueue.data;

                if (!data.extract) {
                    data.extract = [];
                }

                // Keep track of which queues need to be extracted from
                data.extract[utils.queuePos] = 1;
            },

            urls(urls) {
                if (utils.curQueue.next) {
                    return;
                }

                utils.curQueue.next = utils.urlQueue(urls);
            },

            next(selector) {
                if (utils.curQueue.next) {
                    return;
                }

                if (typeof selector === "string") {
                    utils.curQueue.next = utils.clickQueue(selector);

                } else if (typeof selector === "function") {
                    utils.curQueue.next = [{
                        type: "next",
                        action: selector,
                    }];
                }
            },

            visit(selector) {
                if (utils.curQueue.visit) {
                    return;
                }

                if (typeof selector === "string") {
                    utils.curQueue.visit = utils.clickQueue(selector);

                } else if (typeof selector === "function") {
                    utils.curQueue.visit = [{
                        type: "visit",
                        action: selector,
                    }];
                }

                utils.curQueue.visitCount = utils.curQueue.visit.length;
            },
        },

        searchURLs(opt) {
            const urls = [];
            const inc = opt.inc || 1;
            for (let i = opt.start || 1; i <= opt.end; i += inc) {
                urls.push(opt.url.replace(/%s/, i));
            }
            return utils.urlQueue(urls);
        },

        selector(selector, num) {
            return (selector.indexOf("/") >= 0 ? {
                type: "xpath",

                path: num != null ?
                    `(${selector})[${num + 1}]` :
                    selector,
            } : selector);
        },
    };

    return utils;
};
