"use strict";

/***************************************************
 CONSTANTS
 ***************************************************/

var WALKY_SOCKET_PORT = 8663;
var WALKY_WEBSOCK_PORT = 8662;

var REQ_OBJID = 0;
var REQ_METHOD = 1;
var REQ_ARGS = 2;
var REQ_KWARGS = 3;
var REQ_MESSAGE_ID = -1;

var TYPE = 0;
var PAYLOAD = 1;

var PAYLOAD_ERROR = -1;

var PAYLOAD_METHOD_EXECUTE = 0;
var PAYLOAD_PRIMITIVE = 1;
var PAYLOAD_CONTAINS_DISTRIBUTED = 2;
var PAYLOAD_DISTRIBUTED_OBJECT = 3;
var PAYLOAD_OBJECT_DELETED = 8;
var PAYLOAD_ATTRIBUTE_METHOD = 9;

var PAYLOAD_EVENT = 11;
var PAYLOAD_SYSTEM = 12;

var REQUEST_OBJECT = 1;
var REQUEST_METHOD = 2;
var REQUEST_ARGS   = 3;
var REQUEST_KWARGS = 4;

var SYS_INTERROGATION_OBJ_ID = '?';
var SYS_INTERROGATION_ATTR_METHOD = '?';
var SYS_INTERROGATION_SET_METHOD = '=';
var SYS_INTERROGATION_DIR_METHOD = 'dir';
var SYS_INTERROGATION_DEL_METHOD = 'del';

var TARGET_GROUP = 0;
var SOURCE_CLASS = 1;
var MAPPED_CLASS = 2;


/***************************************************
 OBJECTS
 ***************************************************/

var WalkyObjectStub = function ( walkyConnection, regObjID ) {
    this.walkyConnection = walkyConnection;
    this.regObjID = regObjID;
    this.exec = function ( methodName, argsList, keywordDict ) {
        var that = this;
        return that.walkyConnection.exec(
                                  that.regObjID,
                                  methodName, 
                                  argsList, 
                                  keywordDict
                              )
    };
};

var WalkyNormalized = function ( data ) {
    this.data = data;
};

var WalkyInterrogation = function ( walkyConnection ) {
    this.walkyConnection = walkyConnection;
    this['?'] = function ( regObjID, attribute ) {
    // --------------------------------------------------
        var that = this;
        var registry = that.walkyConnection.engine.registry;
        var obj = registry.getObject(regObjID);
        if ( !obj ) return undefined;
        if ( !attribute in obj ) return undefined;
        var attr = obj[attribute];
        // FIXME: This is dirty
        return new WalkyNormalized([
                        PAYLOAD_ATTRIBUTE_METHOD,
                        [1,[regObjID,attribute]]
                    ]);
    };
};

var WalkyObjectWrapper = function ( obj ) {
    this.obj = obj;
};

var WalkyRegistry = function () {
    this.objRegistry = {};
    this.objIDPrefix = "C";
    this.objIDCount = 0;

    this.regObjIDGenerator = function () {
    // --------------------------------------------------
        var that = this;
        var regObjID;
        do {
            regObjID = that.objIDPrefix+that.objIDCount.toString(36);
            that.objIDCount++;
        } while ( regObjID in that.objRegistry );
        return regObjID;
    };

    this.putObject = function ( obj,regObjID ) {
    // --------------------------------------------------
        var that = this;
        if ( !regObjID ) {
            regObjID = that.regObjIDGenerator();
        }
        that.objRegistry[regObjID] = obj;
        return regObjID;
    };

    this.getObject = function ( regObjID ) {
    // --------------------------------------------------
        var that = this;
        if ( regObjID in that.objRegistry ) 
            return that.objRegistry[regObjID]
        return undefined;
    };

};

var WalkyExecRequest = function ( obj, method, args, kwargs ) {
    this.obj = obj;
    this.method = method;
    this.args = args;

    // FIXME: kwargs have no meaning in JS
    // this.kwargs = kwargs;

    this.exec = function() {
    // --------------------------------------------------
        var that = this;
        var result = that.obj[that.method].apply(that.obj,that.args);
        return result;
    };

};

var WalkySerializer = function () {

    this.isComplexObject = function ( obj ) {
    // --------------------------------------------------
    // FIXME: Need a better way to determine if an object is
    // a dict or an object
    //
        for ( var k in obj ) {
            var v = obj[k];
            if ( typeof(v) == "function" ) {
                return true;
            };
        };
        return false;
    };

    this.normalizeData = function ( denormalizedData, registry ) {
    // --------------------------------------------------
        var that = this;

        if (typeof(denormalizedData) == "number") {
            return [PAYLOAD_PRIMITIVE,denormalizedData];
        }
        else if (typeof(denormalizedData) == "string") {
            return [PAYLOAD_PRIMITIVE,denormalizedData];
        }
        else if (typeof(denormalizedData) == "function") {
            // FIXME: Allow direct calls of functions?
            return [PAYLOAD_ATTRIBUTE_METHOD,denormalizedData];
        }
        else if ( denormalizedData.constructor === WalkyNormalized ) {
            return denormalizedData.data;
        }
        else if ( 
            denormalizedData.constructor === Array 
                && !that.isComplexObject(denormalizedData)
        ) {
            var data = [];
            var allPrimitive = true;
            for ( var i=0; i<denormalizedData.length; i++ ) {
                var dv = denormalizedData[i];
                var v = that.normalizeData(dv,registry);
                if ( v[TYPE] != PAYLOAD_PRIMITIVE ) {
                    allPrimitive = false;
                }
                data.push(v);
            };

            // Small local optimization
            if ( allPrimitive ) {
                var newData = [];
                for ( var i=0; i<data.length; i++ ) {
                    newData.push(data[i][PAYLOAD])
                };

                return [PAYLOAD_PRIMITIVE,newData];
            };

            // Requires additional processing
            return [PAYLOAD_DISTRIBUTED_OBJECT,data];
        }
        else if ( 
            denormalizedData.constructor === Object 
                && !that.isComplexObject(denormalizedData)
        ) {
            var data = {};
            var allPrimitive = true;
            for ( var k in denormalizedData ) {
                var dv = denormalizedData[k];
                var v = that.normalizeData(dv,registry);
                if ( v[TYPE] != PAYLOAD_PRIMITIVE ) {
                    allPrimitive = false;
                }
                data[k] = v;
            };

            // Small local optimization
            if ( allPrimitive ) {
                var newData = {};
                for ( var k in data ) {
                    newData[k] = data[k][PAYLOAD];
                };
                return [PAYLOAD_PRIMITIVE,newData];
            };

            // Requires additional processing
            return [PAYLOAD_DISTRIBUTED_OBJECT,data];

        }

        // Oops, this is going to be a complex object.
        else {
            var regObjID = registry.putObject(denormalizedData);
            return [PAYLOAD_DISTRIBUTED_OBJECT,regObjID];
        }
        
    };

    this.denormalizeData = function ( normalizedData, walkyConnection ) {
    // --------------------------------------------------
    // FIXME: This doesn't mirror the python code yet. (It returns the
    //        payload type when it doesn't need to)
    //
        var that = this;
        var respType = normalizedData[TYPE]
        var respPayload = normalizedData[PAYLOAD]
        var denormalizedData;

        switch (respType) {

            case PAYLOAD_PRIMITIVE:
                denormalizedData = respPayload;
                break;

            case PAYLOAD_DISTRIBUTED_OBJECT:
                denormalizedData = new WalkyObjectStub(walkyConnection,respPayload);
                break

            case PAYLOAD_CONTAINS_DISTRIBUTED:
                // FIXME Need to handle this still
                if ( respPayload.constructor === Array ) {
                    denormalizedData = [];
                    for ( var i=0; i<respPayload.length; i++ ) {
                        var p = respPayload[i];
                        var v = that.denormalizeData(p,walkyConnection);
                        denormalizedData.push(v[PAYLOAD]);
                    }
                }
                else if ( respPayload.constructor === Object ) {
                    denormalizedData = {};
                    for ( var k in respPayload ) {
                        var p = respPayload[k];
                        var v = that.denormalizeData(p,walkyConnection);
                        denormalizedData[k] = v[PAYLOAD];
                    }
                }
                break;

            case PAYLOAD_EVENT:
                // FIXME Need to handle this still
                console.log("NOT SURE HOW TO HANDLE THIS");
                break;

            case PAYLOAD_SYSTEM:
                // FIXME Need to handle this still
                console.log("NOT SURE HOW TO HANDLE THIS");
                break;

            case PAYLOAD_ATTRIBUTE_METHOD:
                // FIXME Need to handle this still
                break

            case PAYLOAD_METHOD_EXECUTE:
                // In the case of an execute request things are a bit
                // different. So let's just structure it.
                // FIXME Need to handle this properly
                var registry = walkyConnection.engine.registry;
                var obj = registry.getObject(respPayload);
                denormalizedData = new WalkyExecRequest(
                                        obj,
                                        normalizedData[REQUEST_METHOD],
                                        that.denormalizeData(
                                            normalizedData[REQUEST_ARGS]
                                        )[PAYLOAD]
                                        // FIXME: kwargs have no meaning in JS
                                        // normalizedData[REQUEST_KWARGS],
                                    );
                break;

        };

        return [ respType, denormalizedData ];
    };
};

var WalkyEngine = function () {
    this.serializer = new WalkySerializer();
    this.registry = new WalkyRegistry();
};

var WalkyConnection = function () {

    this.engine = new WalkyEngine();
    this.engine.registry.putObject(new WalkyInterrogation(this),'?');

    this.messageCount = 0;

    this.messageWaiting = {};

    this.open = function ( wsUri ) {
    // --------------------------------------------------
        var that = this;
        var promise = new RSVP.Promise(function(resolve,reject){
            that.ws = new WebSocket( wsUri );
            that.ws.onmessage = function (ev) { 
                console.log("<---------",ev.data);
                that.onmessage(ev);
            };
            that.ws.onopen = function (ev) { 
                that.onopen(ev);
                resolve(ev);
            };
        });
        return promise;
    };

    this.getObject = function (regObjID) {
    // --------------------------------------------------
        var that = this;
        return new WalkyObjectStub(that,regObjID);
    };

    this.nextID = function() {
    // --------------------------------------------------
        var that = this;
        var messageID = "c"+(that.messageCount++).toString();
        return messageID;
    };

    this.messageWaitForMessageID = function( messageID, resolve, reject ) {
    // --------------------------------------------------
        var that = this;
        that.messageWaiting[messageID] = [resolve,reject];
    };

    this.exec = function ( objectID, methodName, argsList, keywordDict ) {
    // --------------------------------------------------
        var that = this;
        var promise = new RSVP.Promise(function(resolve,reject){
            var jsonRequest = "";
            var messageID = that.nextID();
            that.messageWaitForMessageID(messageID,resolve,reject);

            // Normalize outgoing data
            var serializer = that.engine.serializer;
            var registry = that.engine.registry;

            if ( !argsList ) argsList = [];
            argsList = that.engine.serializer.normalizeData(argsList,registry)

            if ( !keywordDict ) keywordDict = {};
            keywordDict = that.engine.serializer.normalizeData(keywordDict,registry)

            // Encode into transport stream
            var wsLine = JSON.stringify([
                                  PAYLOAD_METHOD_EXECUTE,
                                  objectID,
                                  methodName,
                                  argsList,
                                  keywordDict,
                                  messageID
                              ])+"\r\n";

            // Then send it off
            console.log("TO:",wsLine);
            that.ws.send(wsLine);
        });
        return promise;
    };

    this.execRequest = function( execRequest, respMessageID ) {
    // --------------------------------------------------
        var that = this;
        var result = execRequest.exec();
        var normalizedResult = that.engine.serializer.normalizeData(
                                              result,
                                              that.engine.registry)

        normalizedResult.push(respMessageID);

        // Encode into transport stream
        var wsLine = JSON.stringify(normalizedResult)+"\r\n";

        // Then send it off
        console.log("TO:",wsLine);
        that.ws.send(wsLine);
    };

    this.close = function () {
    // --------------------------------------------------
        var that = this;
        that.ws.close();
    };

    this.onopen = function (ev) {
    // --------------------------------------------------
    // FIXME: Do I need to do anything here?
    //
    };

    this.onmessage = function (ev) {
    // --------------------------------------------------
    // FIXME: needs exception support for failed parses
        var that = this;
        var normalizedData = JSON.parse(ev.data);
        var respMessageID = normalizedData[normalizedData.length-1];

        // Parse incoming data
        var serializer = that.engine.serializer;
        var denormalizedData = serializer.denormalizeData(normalizedData,that);

        var respType = denormalizedData[TYPE];
        var payload = denormalizedData[PAYLOAD];

        // We got a request to execute an object method,
        // let's do so.
        if ( respType == PAYLOAD_METHOD_EXECUTE ) {
            that.execRequest(payload,respMessageID);
        }

        // If something's waiting on it, resolve it.
        else if ( respMessageID in that.messageWaiting ) {
            var waiting = that.messageWaiting[respMessageID];
            delete that.messageWaiting[respMessageID];
            // FIXME: The following is _ugly_
            waiting[0](payload);
        }
    };

};
