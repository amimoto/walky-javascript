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
var PAYLOAD_DATA = 1;
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

var DEBUG = true;

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

var WalkyEnveloped = function ( data ) {
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
        return new WalkyEnveloped([
                        PAYLOAD_ATTRIBUTE_METHOD,
                        [regObjID,attribute]
                    ]);
    };

    this['del'] = function ( regObjID ) {
        var that = this;
        var registry = that.walkyConnection.engine.registry;
        registry.delObject(regObjID);
        console.log("Deleted object:",regObjID);
        return true;
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
            return that.objRegistry[regObjID];
        if (DEBUG) console.log("Could not find object:", regObjID);
        return;
    };

    this.delObject = function ( regObjID ) {
    // --------------------------------------------------
        var that = this;
        if ( regObjID in that.objRegistry ) 
            delete that.objRegistry[regObjID];
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

    this.envelopeWrap = function ( denormalizedData, registry, messageID ) {
    // --------------------------------------------------
        var that = this;

        if ( denormalizedData && denormalizedData.constructor == WalkyEnveloped ) {
            var envelopedData = denormalizedData.data;
            envelopedData.push(messageID);
            return envelopedData;
        }

        var normalizedData = that.normalizeData( denormalizedData, registry );
        var envelopedData = [ PAYLOAD_DATA, normalizedData, messageID ];
        return envelopedData;
    };

    this.normalizeData = function ( denormalizedData, registry ) {
    // --------------------------------------------------
        var that = this;
        if (typeof(denormalizedData) == "number") {
            return denormalizedData;
        }
        else if (typeof(denormalizedData) == "boolean") {
            return denormalizedData;
        }
        else if (typeof(denormalizedData) == "string") {
            var firstChar = denormalizedData.charAt(0);
            if (firstChar == '!' ) {
                return '!'+denormalizedData;
            }
            return denormalizedData;
        }
        else if (typeof(denormalizedData) == "function") {
            // FIXME: Allow direct calls of functions?
            console.log("?????????????????????????????",denormalizedData);
            return [PAYLOAD_ATTRIBUTE_METHOD,denormalizedData];
        }

        else if (typeof(denormalizedData) == "undefined") {
            return denormalizedData;
        }

        else if ( denormalizedData.constructor === WalkyEnveloped ) {
            return denormalizedData.data;
        }
        else if ( 
            denormalizedData.constructor === Array 
                && !that.isComplexObject(denormalizedData)
        ) {
            var data = [];
            for ( var i=0; i<denormalizedData.length; i++ ) {
                var dv = denormalizedData[i];
                var v = that.normalizeData(dv,registry);
                data.push(v);
            };
            return data;
        }
        else if ( 
            denormalizedData.constructor === Object 
                && !that.isComplexObject(denormalizedData)
        ) {
            var data = {};
            for ( var k in denormalizedData ) {
                var dv = denormalizedData[k];
                var v = that.normalizeData(dv,registry);
                data[k] = v;
            };
            return data;
        }

        // Oops, this is going to be a complex object.
        else {
            var regObjID = registry.putObject(denormalizedData);
            return "!O"+regObjID;
        }
    };

    this.envelopeUnwrap = function ( normalizedData, walkyConnection, registry ) {
    // --------------------------------------------------
        var that = this;
        var respType = normalizedData[TYPE]
        var respPayload = normalizedData[PAYLOAD]
        var denormalizedData;

        switch (respType) {

            case PAYLOAD_DATA:
                return that.denormalizeData(respPayload, walkyConnection, registry)

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

                if ( !obj ) {
                    return new WalkyEnveloped([
                                    PAYLOAD_ERROR,
                                    "Unknown Object"
                                ]);
                }

                // Note that we need to double check that the args
                // actually exists. We don't want to accidentally use
                // the message ID as the argument
                // [ type, object, function, args, kwargs, message ].length == 6
                // [ type, object, function, message ].length == 4
                // So length needs to be greater than 4
                var args = normalizedData.length > 4
                                ? normalizedData[REQUEST_ARGS]
                                : [];
                if (DEBUG) console.log("USING ARGS:", args, normalizedData.length);
                var result = new WalkyExecRequest(
                                        obj,
                                        normalizedData[REQUEST_METHOD],
                                        that.denormalizeData(
                                            args,
                                            walkyConnection,
                                            registry
                                        )
                                        // FIXME: kwargs have no meaning in JS
                                        // normalizedData[REQUEST_KWARGS],
                                    );
                return result;
        };


    };

    this.denormalizeData = function ( normalizedData, walkyConnection, registry ) {
    // --------------------------------------------------
    // FIXME: This doesn't mirror the python code yet. (It returns the
    //        payload type when it doesn't need to)
    //
        var that = this;
        var denormalizedData;

        if (typeof(normalizedData) == "number") {
            return normalizedData;
        }
        else if (typeof(normalizedData) == "boolean") {
            return normalizedData;
        }
        else if (typeof(normalizedData) == "string") {
            if ( !normalizedData.length ) 
                return normalizedData;
            var firstChar = normalizedData.charAt(0);
            if ( firstChar != '!' )
                return normalizedData;
            if ( normalizedData.length == 1 )
                return normalizedData; // FIXME: Should throw an error
            var secondChar = normalizedData.charAt(1);
            switch (secondChar) {
                case '!':
                    return normalizedData.substring(1);

                case 'd':
                    return new Date(normalizedData.substring(2));

                case 'D':
                    return new Date(normalizedData.substring(2));

                case 'O':
                    // FIXME: handle metadata information
                    return new WalkyObjectStub(
                                          walkyConnection,
                                          normalizedData.substring(2)
                                      );

                default:
                    // FIXME: Should throw an error
            };
            return;
        }
        else if (typeof(normalizedData) == "function") {
            // FIXME: Allow direct calls of functions?
            if (DEBUG) console.log("BUSTED FOR FUNCTIONS SO FAR");
        }
        else if ( 
            normalizedData.constructor === Array 
                && !that.isComplexObject(normalizedData)
        ) {
            var data = [];
            for ( var i=0; i<normalizedData.length; i++ ) {
                var dv = normalizedData[i];
                var v = that.denormalizeData(dv,walkyConnection,registry);
                data.push(v);
            };
            return data;
        }
        else if ( 
            normalizedData.constructor === Object 
                && !that.isComplexObject(normalizedData)
        ) {
            var data = {};
            for ( var k in normalizedData ) {
                var dv = normalizedData[k];
                var v = that.denormalizeData(dv,walkyConnection,registry);
                data[k] = v;
            };
            return data;
        };
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
                if (DEBUG) console.log("<---------",ev.data);
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
                              ]);

            // Then send it off
            that.sendLine(wsLine);
        });
        return promise;
    };

    this.execRequest = function( execRequest, respMessageID ) {
    // --------------------------------------------------
        var that = this;
        var result = execRequest.exec();
        var envelopedData = that.engine.serializer.envelopeWrap(
                                                        result,
                                                        that.engine.registry,
                                                        respMessageID
                                                    );

        // Encode into transport stream
        var wsLine = JSON.stringify(envelopedData);

        // Then send it off
        that.sendLine(wsLine);
    };

    this.sendLine = function ( wsLine ) {
    // --------------------------------------------------
        var that = this;
        if (DEBUG) console.log("-->",wsLine);
        that.ws.send(wsLine+"\r\n");
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

    this.receiveLine = function (line) {
    // --------------------------------------------------
        var that = this;
        var envelopedData = JSON.parse(line);
        var respMessageID = envelopedData[envelopedData.length-1];
        var respType = envelopedData[TYPE];

        // Parse incoming data
        var serializer = that.engine.serializer;
        var denormalizedData = serializer.envelopeUnwrap(
                                              envelopedData,
                                              that,
                                              that.engine.registry
                                          );

        // We got a request to execute an object method,
        // let's do so.
        if ( respType == PAYLOAD_METHOD_EXECUTE ) {
            that.execRequest(denormalizedData,respMessageID);
        }

        // If something's waiting on it, resolve it.
        else if ( respMessageID in that.messageWaiting ) {
            var waiting = that.messageWaiting[respMessageID];
            delete that.messageWaiting[respMessageID];
            // FIXME: The following is _ugly_
            waiting[0](denormalizedData);
        }

    };

    this.onmessage = function (ev) {
    // --------------------------------------------------
    // FIXME: needs exception support for failed parses
        var that = this;
        var lines = ev.data.split('\n');
        for ( var i = 0; i < lines.length; i++ ) {
            var line = lines[i];
            if ( line ) that.receiveLine(lines[i]);
        };
    };

};
