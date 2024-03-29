/**
 * TODO : buggy
 * */

var sysconf = require('./config');
var casper = require("casper").create();
var fs = require("fs");
var system = require("system");
var md5 = require("./md5");
var utils = require('./utils');
var logger = require('./logger');

var DefaultConfig = {
    "userAgent": "chrome",
    "userAgentAliases": {
        "chrome": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/535.11 (KHTML, like Gecko) Chrome/17.0.963.12 Safari/535.11"
    },
    "fetchTimeout" : 30 * 1000,
    "scrollCount" : 10,
    "scrollTimeout" : 5 * 1000,
    "consolePrefix": "#",
    "viewportWidth": 1920,
    "viewportHeight": 1080
};

var DefaultScrollInterval = 500; // ms

function Fetcher() {
	this.config = DefaultConfig;

	this.pageRequested = false;
	this.pageLoaded = false;
	this.pageClosed = false;

	this.scrollCount = 0;
	this.scrollInterval = false;
	this.lastScrollTime = new Date().getTime();
	this.ajaxRequests = 0;
	this.ajaxResponses = 0;
	this.mainResponse = false;
};

Fetcher.prototype.fetch = function(url, config, onContentComplete) {
	// TODO : why need this merge? should we just use the config file or just use the passed by
	// config?
    if (config) {
        this.config = require('./config').mergeConfig(this.config, config);
    }
    this.config.url = url;

    // set user agent
    if (config.userAgentAliases[config.userAgent]) {
        config.userAgent = config.userAgentAliases[config.userAgent];
    }

    casper.options = {
       viewportSize : {
    	   width: config.viewportWidth,
    	   height: config.viewportHeight
       },
       clientScripts : ["humanize.js", "visualize.js"],
       pageSettings : {
    	   loadPlugins : false,
    	   loadImages : true
       },
       userAgent : config.userAgent,
       logLevel : "debug",
       verbose : true
    };

//    // 注册WebPage回调函数
//    // @see https://github.com/ariya/phantomjs/wiki/API-Reference-WebPage#callbacks-list
//    // 在tasks注册事件处理器，tasks中注册的事件处理器同原生的WebPage处理器函数原型多了两个参数：page和config
//    var fetcher = this;
//    var events = [
//        'onError',
//        'onPageInitialized',
//        'onResourceRequested',
//        'onResourceReceived',
//        'onResourceTimeout'
//    ];
//
//    events.forEach(function (event) {
//        if (!fetcher[event]) return;
//
//        // register events
//    	casper.options[event] = function () {
//            var args = [casper, config];
//            for (var i = 0; i < arguments.length; i++) {
//                args.push(arguments[i]);
//            }
//
//            // 在WebPage函数参数的基础上，增加了casper和config两个输入参数
//            fetcher[event].apply(fetcher, args);
//        };
//    });

    // 注册Fetcher回调函数
    if (onContentComplete) {
        this.onContentComplete = function(response, page) {
            // logger.debug("call user defined complete handler");

            if (!fetcher.pageClosed) {
            	fetcher.pageClosed = true;

                onContentComplete(response, page);
            	page.close();
            }
            else {
                logger.error("page is closed");
            }
        };
    }

    casper.start(config.url, function() {
        // TODO : is it correct? should we permit the redirection?
        // casper.options.page.navigationLocked = true;
    });

    casper.then(function() {
    	// TODO : should we scroll step by step?
    	this.scrollToBottom();
    });

    casper.waitFor(function check() {
    	return true;
    }, function then() {
    	this.evaluate(function() {
        	document.body.setAttribute("data-url", document.URL);

        	var debug = false;
        	var ele = debug ? document.body : document.body.getElementsByTagName('div')[0];
        	ele.setAttribute("id", "QiwurScrapingMetaInformation");
        	ele.setAttribute("data-domain", document.domain);
        	ele.setAttribute("data-url", document.URL);
        	ele.setAttribute("data-base-uri", document.baseURI);

        	__qiwur__visualize(document);
        	__qiwur__humanize(document);

        	// if any script error occurs, the flag can NOT be seen
        	document.body.setAttribute("data-evaluate-error", 0);    		
    	});
    });

    casper.run();
};

Fetcher.prototype.onError = function(msg, trace) {
	var msgStack = ['ERROR: ' + msg];
	if (trace && trace.length) {
	    msgStack.push('TRACE:');
	    trace.forEach(function(t) {
	    	msgStack.push(' -> ' + t.file + ': ' + t.line);
	    });
	}
	logger.error(msgStack.join('\n'));
};

Fetcher.prototype.onResourceRequested = function (casper, config, requestData, request) {
    // logger.debug('Request (#' + requestData.id + ')');
    // logger.debug('Request (#' + requestData.id + '): ' + JSON.stringify(requestData));

    if (this.pageLoaded) {
        ++this.ajaxRequests;
    }
};

Fetcher.prototype.onResourceReceived = function (casper, config, response) {
    if (!this.mainResponse) {
        // logger.debug("main response : " + JSON.stringify(response));
        this.mainResponse = response;
    }

    if (response.stage == 'end') {
         // logger.debug("#" + response.id + " loaded");
         // logger.debug("#" + response.id + " loaded \n" + JSON.stringify(response));
    }

    if (this.pageLoaded && response.stage == 'end') {
        ++this.ajaxResponses;
    }
};

Fetcher.prototype.onResourceTimeout = function(casper, config, request) {
	logger.error("#" + request.id + " timeout");
};

Fetcher.prototype.onLoadFinished = function (casper, config, status) {
    // enter here twice due to a phantomjs bug
    // http://stackoverflow.com/questions/11597990/phantomjs-ensuring-that-the-response-object-stays-alive-in-server-listen
	// or there is a redirect request
    if (!this.pageRequested || this.pageLoaded || this.pageClosed) {
    	logger.error('bad page status. ' + this.pageStatus());
    	return;
    }

    this.pageLoaded = true;

	// redirect response. NOTICE : status is fail here
	if (this.mainResponse && this.mainResponse.status >= 300 && this.mainResponse.status < 400) {
		fetcher.onContentComplete(fetcher.mainResponse, casper.page);
		return;
	}

	// TODO : we do not handle the following redirect situations : 
	// 1. <meta http-equiv="refresh" ...>
	// 2. redirect using javascript:location

    if (status != 'success') {
        logger.error('FAILED TO LOAD ');
		fetcher.onContentComplete(fetcher.mainResponse, casper.page);
        return;
    }

    this.startScrollTimer();

    page.evaluate(function() {
    	document.body.setAttribute("data-url", document.URL);

    	var debug = false;
    	var ele = debug ? document.body : document.body.getElementsByTagName('div')[0];
    	ele.setAttribute("id", "QiwurScrapingMetaInformation");
    	ele.setAttribute("data-domain", document.domain);
    	ele.setAttribute("data-url", document.URL);
    	ele.setAttribute("data-base-uri", document.baseURI);

    	__qiwur__visualize(document);
    	__qiwur__humanize(document);

    	// if any script error occurs, the flag can NOT be seen
    	document.body.setAttribute("data-evaluate-error", 0);
    });

    this.waitForContentComplete();
};

Fetcher.prototype.onContentComplete = function(response, page) {
    logger.debug("content complete in fetcher");
    logger.debug(JSON.stringify(response));

    response.close();
};

Fetcher.prototype.waitForContentComplete = function() {
	var fetcher = this;
	var config = fetcher.config;

    var checkTimes = 8; // 检查8次，间隔250ms，也就是2s
    var waitfor = require('./waitfor').create(function() {
    	if (fetcher.pageClosed) {
        	logger.debug('the page is already closed, quit waiting');
    		return true;
    	}

//            logger.debug(" scroll count : " + fetcher.scrollCount
//            + " ajax requests : " + fetcher.ajaxRequests 
//            + " ajax respounses : " + fetcher.ajaxResponses);

        // 情形1
        // 所有滚动事件都发出去了，所有的结果都收回来了，这种情形一般是一个滚动有一条响应
        if (fetcher.scrollCount >= config['scrollCount'] && fetcher.scrollCount >= fetcher.ajaxResponses) {
            return true;
        }

        // 情形2
        // 所有滚动事件都发出去了后，又过来一段时间，没有更多数据返回，那么认为不会再有事件了
        if (fetcher.scrollCount >= config['scrollCount']) {
            if (new Date().getTime() - fetcher.lastScrollTime >= config['scrollTimeout']) {
                return true;
            }
        }

        // 情形3
        // 发出了滚动事件，结果没有收回，反复检查几次，认为滚动事件已经不能触发ajax请求了
        var hasTrivalScroll = fetcher.scrollCount > fetcher.ajaxRequests
            || fetcher.scrollCount > fetcher.ajaxResponses;

        if (hasTrivalScroll) {
//            logger.debug("trival scroll, waiting ... status : " + fetcher.pageLoaded + " " + checkTimes + " "
//                    + fetcher.scrollCount + " " + fetcher.ajaxRequests + " " + fetcher.ajaxResponses);

            return --checkTimes <= 0;
        }

        // try again until timeout
        return false;
    }, function() {
        // condition fulfilled
        // logger.info("condition fulfilled. " + fetcher.pageStatus());

        fetcher.stopScrollTimer();

        fetcher.onContentComplete(fetcher.mainResponse, fetcher.page);
    }, function() {
        // timeout processor
        logger.info("time out, page is valid. " + fetcher.pageStatus());

        fetcher.stopScrollTimer();

        fetcher.onContentComplete(fetcher.mainResponse, fetcher.page);
    },
    config.fetchTimeout);

    waitfor.startTimer();
};

Fetcher.prototype.startScrollTimer = function() {
    // 每隔一段时间滚动一次
    var fetcher = this;
    var config = this.config;

    var tick = config['scrollCount'];
    fetcher.scrollInterval = setInterval(function() {
    	if (fetcher.pageClosed) {
    		fetcher.stopScrollTimer();
            return;
    	}

        // logger.debug("tick : " + tick + " scroll down : " + fetcher.scrollCount);
        --tick;

        // send scroll event
        fetcher.page.evaluate(function() {
            window.document.body.scrollTop = document.body.scrollHeight / 1.5;
        });

        fetcher.lastScrollTime = new Date().getTime();

        if (++fetcher.scrollCount >= config['scrollCount']) {
        	fetcher.stopScrollTimer();
        }
    }, DefaultScrollInterval);
};

Fetcher.prototype.stopScrollTimer = function() {
	if (this.scrollInterval) {
        clearInterval(this.scrollInterval);
        this.scrollInterval = null;
	}
};

Fetcher.prototype.pageStatus = function() {
	return 'page status : { requested : ' + this.pageRequested + ', loaded : ' 
		+ this.pageLoaded + ', closed : ' + this.pageClosed + '}';
};

exports.create = function() {
	return new Fetcher();
};
