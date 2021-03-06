var Sync = require("sync");
var s = require("./structures");
var StatusCodes = require("./opcua_status_code").StatusCodes;
var assert = require('better-assert');

var async = require('async');
var util = require("util");
var debugLog = require("../lib/utils").make_debugLog(__filename);

var ServerEngine = require("../lib/server/server_engine").ServerEngine;
var browse_service = require("./browse_service");
var read_service = require("./read_service");
var write_service = require("./write_service");
var subscription_service = require("./subscription_service");
var translate_service = require("../lib/translate_browse_paths_to_node_ids_service");

var ActivateSessionResponse = require("./session_service").ActivateSessionResponse;
var CreateSessionResponse = require("./session_service").CreateSessionResponse;

var _ = require("underscore");
var NodeId = require("./nodeid").NodeId;
var NodeIdType = require("./nodeid").NodeIdType;
var crypto = require("crypto");
var DataValue = require("./datavalue").DataValue;
var DataType = require("./variant").DataType;
var MonitoredItem = require("./server/monitored_item").MonitoredItem;
var dump = require("./utils").dump;



var OPCUAServerEndPoint = require("./server/server_endpoint").OPCUAServerEndPoint;

var OPCUABaseServer = require("../lib/server/base_server").OPCUABaseServer;

function OPCUAServer(options) {

    options = options || {};

    OPCUABaseServer.apply(this,arguments);

    var self = this;

    self.options = options;

    self.engine = new ServerEngine();

    self.nonce = crypto.randomBytes(32);

    self.protocolVersion = 1;
    self.connected_client_count = 0;

    var port = options.port || 26543;

    // add the tcp/ip endpoint with no security
    var endpoint = new OPCUAServerEndPoint(this, port , {
        defaultSecureTokenLifetime: options.defaultSecureTokenLifetime || 60000
    });
    self.endpoints.push(endpoint);

    endpoint.on("message", function(message,channel) {
        self.on_request(message,channel);
    });

    self.serverType = s.ApplicationType.SERVER;
}
util.inherits(OPCUAServer,OPCUABaseServer);

OPCUAServer.prototype.__defineGetter__("buildInfo",function(){ return this.engine.buildInfo; });

/**
 * create and register a new session
 * @returns {ServerSession}
 */
OPCUAServer.prototype.createSession = function() {
    var self = this;
    return self.engine.createSession();
};

/**
 * retrieve a session by authentication token
 *
 * @param authenticationToken
 */
OPCUAServer.prototype.getSession = function(authenticationToken) {
    var self = this;
    return self.engine.getSession(authenticationToken);
};

/**
 * @returns true if the server has been initialized
 *
 */
OPCUAServer.prototype.__defineGetter__("initialized",function () {
    var self = this;
    return self.engine.address_space != null;
});


/**
 * Initialize the server by installing default node set.
 * This is a asynchronous function that requires a callback function.
 * The callback function typically completes the creation of custom node
 * and instruct the server to listen to its endpoints.
 *
 * @param {function} done callback
 */
OPCUAServer.prototype.initialize = function (done) {

    var self = this;
    assert(!self.initialized);// already initialized ?
    self.engine.initialize(self.options,function() {
       done();
    });
};


/**
 * Initiate the server by starting all its endpoints
 */
OPCUAServer.prototype.start = function (done) {

    var self = this;
    var tasks = [];
    if (!self.initialized) {
        tasks.push(function (callback) {
            self.initialize(callback);
        });
    }
    tasks.push(function(callback) {
        OPCUABaseServer.prototype.start.call(self,callback);
    });
    var q = async.series(tasks,done);


};

OPCUAServer.prototype.shutdown = OPCUABaseServer.prototype.shutdown;

OPCUAServer.prototype.getCertificate = function () {
    if (!this.certificate) {
        // create fake certificate
        var read_certificate = require("../lib/crypto_utils").read_certificate;
        this.certificate = read_certificate("certificates/cert.pem");
    }
    return this.certificate;
};



OPCUAServer.prototype.getSignedCertificate = function() {

    var self = this;
    return new s.SignedSoftwareCertificate({
        certificateData: self.getCertificate(),
        signature: new Buffer("HelloWorld")
    });
};

// session services
OPCUAServer.prototype._on_CreateSessionRequest = function(message,channel)  {

    var server = this;
    var request = message.request;
    assert(request._schema.name === "CreateSessionRequest");

    var session = server.createSession();
    assert(session);

    var response = new CreateSessionResponse({
        // A identifier which uniquely identifies the session.
        sessionId:  session.nodeId,

        // The token used to authenticate the client in subsequent requests.
        authenticationToken:  session.authenticationToken,

        revisedSessionTimeout: request.requestedSessionTimeout,

        serverNonce: server.nonce,

        serverCertificate:  server.getCertificate(),

        //The endpoints provided by the server.
        serverEndpoints: server._get_endpoints(),


        serverSoftwareCertificates: null,
        serverSignature: null,
/*
        // SignedSoftwareCertificate: The software certificates owned by the server.
        serverSoftwareCertificates: [
            server.getSignedCertificate()
        ],

        // SignatureData : A signature created with the server certificate.
        //
        // This is a signature generated with the private key associated with the
        // server Certificate. This parameter is calculated by appending the client Nonce to the
        // client Certificate and signing the resulting sequence of bytes.
        // The Signature Algorithm shall be the asymmetric Signature algorithm specified in the
        // Security Policy for the Endpoint
        serverSignature: null,
*/
        // The maximum message size accepted by the server
        maxRequestMessageSize:  0x4000000

    });
    assert(response.authenticationToken);
    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._on_ActivateSessionRequest = function(message,channel)  {

    var server = this;
    var request = message.request;
    assert(request._schema.name === "ActivateSessionRequest");

    // get session from authenticationToken
    var authenticationToken = request.requestHeader.authenticationToken;
    var session = server.getSession(authenticationToken);

    var response;
    if (!session) {
        console.log(" Bad Session in  _on_ActivateSessionRequest".yellow.bold,authenticationToken.value.toString("hex"));

        //xx response = new s.ServiceFault({
        response = new ActivateSessionResponse({
            responseHeader: { serviceResult: StatusCodes.Bad_SessionNotActivated }
        });
    } else {
        response = new ActivateSessionResponse({
            serverNonce: server.nonce
        });
    }
    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._on_CloseSessionRequest = function(message,channel)  {

    var server = this;
    var request = message.request;

    var response;
    assert(request._schema.name === "CloseSessionRequest");
    var session = server.getSession(request.requestHeader.authenticationToken);
    if (!session) {
        console.log("severs.sessions = ",Object(server.sessions).keys());
        console.log(" Bad Session in  _on_CloseSessionRequest");
        response = new s.ServiceFault({
            responseHeader: { serviceResult: StatusCodes.Bad_SessionClosed}
        });
    } else {
        response = new s.CloseSessionResponse({});
    }
    channel.send_response("MSG", response, message);
};

// browse services
OPCUAServer.prototype._on_BrowseRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "BrowseRequest");
    assert(request.nodesToBrowse[0]._schema.name === "BrowseDescription");

    var results = engine.browse(request.nodesToBrowse);
    assert(results[0]._schema.name =="BrowseResult");

    var response = new browse_service.BrowseResponse({
        results: results,
        diagnosticInfos: null
    });
    channel.send_response("MSG", response, message);
};

// read services
OPCUAServer.prototype._on_ReadRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "ReadRequest");
    assert(request.nodesToRead[0]._schema.name === "ReadValueId");
    assert(request.timestampsToReturn);

    var results = engine.read(request);

    assert(results[0]._schema.name === "DataValue");

    var response = new read_service.ReadResponse({
        results: results,
        diagnosticInfos: null
    });
    //xx console.log("response ",util.inspect(JSON.parse(JSON.stringify(response)),{colors:true,depth:10}));

    channel.send_response("MSG", response, message);
};

// write services
OPCUAServer.prototype._on_WriteRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "WriteRequest");
    assert(_.isArray(request.nodesToWrite));
    assert(request.nodesToWrite.length>0);
    assert(request.nodesToWrite[0]._schema.name === "WriteValue");

    var results = engine.write(request.nodesToWrite);

    assert(_.isArray(results));
    assert(results.length === request.nodesToWrite.length);

    var response = new write_service.WriteResponse({
        results: results,
        diagnosticInfos: null
    });
    channel.send_response("MSG", response, message);
};

// subscription services
OPCUAServer.prototype._on_CreateSubscriptionRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "CreateSubscriptionRequest");
    assert(_.isFinite(request.requestedPublishingInterval));

    var subscription = engine.createSubscription(request);

    var response = new subscription_service.CreateSubscriptionResponse({
        subscriptionId: subscription.id,
        revisedPublishingInterval: subscription.publishingInterval,
        revisedLifetimeCount:      subscription.maxLifeTimeCount,
        revisedMaxKeepAliveCount:  subscription.maxKeepAliveCount
    });
    channel.send_response("MSG", response, message);
};

// write services
OPCUAServer.prototype._on_DeleteSubscriptionsRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;

    assert(request._schema.name === "DeleteSubscriptionsRequest");

    var results =request.subscriptionIds.map(function(subscriptionId){
       return engine.deleteSubscription(subscriptionId);
    });

    var response = new subscription_service.DeleteSubscriptionsResponse({
        results: results
    });
    channel.send_response("MSG", response, message);
};



function readValue2(self,oldValue,node,itemToMonitor) {
    assert(self instanceof MonitoredItem);

    var dataValue = node.readAttribute(itemToMonitor.attributeId);

    if (dataValue.statusCode === StatusCodes.Good) {
        if (!_.isEqual(dataValue.value,oldValue)) {
            self.recordValue(dataValue.value);
        }
    } else {
        console.log("readValue2 Error",JSON.stringify(dataValue.statusCode));
    }
}

function build_scanning_node_function(engine,itemToMonitor,monitoredItem) {

    var ReadValueId = require("./read_service").ReadValueId;
    assert(itemToMonitor instanceof ReadValueId);

    var node = engine.findObject(itemToMonitor.nodeId);

    if (!node) {

        console.log(" INVALID NODE ID  , ",itemToMonitor.nodeId.toString());
        dump(itemToMonitor);
        return function() {
            return new DataValue({
                statusCode: StatusCodes.Bad_NodeIdUnknown,
                value: { dataType: DataType.Null, value:0 }
            });
        };
    }

    function readFunc(oldValue) {
        return readValue2(this,oldValue,node,itemToMonitor);
    }
    return readFunc;

}

OPCUAServer.prototype._on_CreateMonitoredItemsRequest = function (message, channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "CreateMonitoredItemsRequest");

    var subscription = engine.getSubscription(request.subscriptionId);
    var response;
    if (!subscription) {
        response = new subscription_service.CreateMonitoredItemsResponse({
            responseHeader : { serviceResult: StatusCodes.Bad_SubscriptionIdInvalid  }
        });
    } else {
        // var itemsToCreate = request.itemsToCreate;
        var timestampsToReturn = request.timestampsToReturn;

        var results = request.itemsToCreate.map(function(monitoredItemCreateRequest){

            var itemToMonitor       = monitoredItemCreateRequest.itemToMonitor;
            //xx var monitoringMode      = monitoredItemCreateRequest.monitoringMode; // Disabled, Sampling, Reporting
            //xx var requestedParameters = monitoredItemCreateRequest.requestedParameters;

            var monitoredItemCreateResult = subscription.createMonitoredItem(timestampsToReturn,monitoredItemCreateRequest);

            var monitoredItem = subscription.getMonitoredItem(monitoredItemCreateResult.monitoredItemId);

            var readNodeFunc =  build_scanning_node_function(engine,itemToMonitor);

            monitoredItem.on("samplingEvent",readNodeFunc);
            return monitoredItemCreateResult;
        });

        response = new subscription_service.CreateMonitoredItemsResponse({
            responseHeader : {},
            results: results
            //,diagnosticInfos: []
        });
    }
    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._on_PublishRequest = function (message, channel)  {

    var server = this;
    var request = message.request;
    var engine = server.engine;

    assert(engine.publishEngine); // server.publishEngine doesn't exists, OPCUAServer has probably shut down already
    assert(request._schema.name === "PublishRequest");
    engine.publishEngine._on_PublishRequest(request,channel);
    engine.publishEngine.once("publishResponse",function(request,response){
        channel.send_response("MSG", response, message);
    });

    // channel.send_response("MSG", response, request);
};

OPCUAServer.prototype._on_SetPublishingModeRequest = function(message,channel)  {
    var request = message.request;
    assert(request._schema.name === "SetPublishingModeRequest");
    var response;

    response = new subscription_service.SetPublishingModeResponse({
        results : [],
        diagnosticInfos: null
    });

    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._on_DeleteMonitoredItemsRequest = function(message,channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "DeleteMonitoredItemsRequest");

    var subscriptionId = request.subscriptionId;
    assert(subscriptionId!=null);

    var subscription = engine.getSubscription(subscriptionId);
    var response;

    if (!subscription) {
        console.log("Cannot find subscription ",subscriptionId);
        response = new subscription_service.DeleteMonitoredItemsResponse({
            responseHeader : { serviceResult: StatusCodes.Bad_SubscriptionIdInvalid  }
        });
    } else {

        var results = request.monitoredItemIds.map(function(monitoredItemId){
            return subscription.removeMonitoredItem(monitoredItemId);
        });

        response = new subscription_service.DeleteMonitoredItemsResponse({
            results : results,
            diagnosticInfos: null
        });
    }
    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._on_RepublishRequest = function(message,channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "RepublishRequest");

    var response;

    var subscription = engine.getSubscription(request.subscriptionId);

    if (!subscription) {
        response = new subscription_service.RepublishResponse({
            responseHeader : {
                serviceResult: StatusCodes.Bad_SubscriptionIdInvalid
            }
        });

    } else {
        response = new subscription_service.RepublishResponse({
            notificationMessage : {
            }
        });
    }
    channel.send_response("MSG", response, message);
};
OPCUAServer.prototype._on_TranslateBrowsePathsToNodeIdsRequest = function(message,channel)  {
    var server = this;
    var request = message.request;
    var engine = server.engine;
    assert(request._schema.name === "TranslateBrowsePathsToNodeIdsRequest");

    var browsePathResults = request.browsePath.map(function(browsePath){
        return engine.browsePath(browsePath);
    });
    var  response = new translate_service.TranslateBrowsePathsToNodeIdsResponse({
        results : browsePathResults,
        diagnosticInfos: null
    });
    channel.send_response("MSG", response, message);
};

OPCUAServer.prototype._get_endpoints = function() {
    return this.endpoints.map(function (endpoint) {
        return endpoint.endpointDescription();
    });
};
/**
 *
 * @param message
 * @param channel
 * @private
 */
OPCUAServer.prototype._on_GetEndpointsRequest = function (message, channel) {

    var server = this;
    var request = message.request;
    assert(request._schema.name === "GetEndpointsRequest");

    var response = new s.GetEndpointsResponse({});

    response.endpoints = server._get_endpoints();

    channel.send_response("MSG", response, message);

};


/**
 *
 * @param discovery_server_endpointUrl
 * @param callback
 */
OPCUAServer.prototype.registerServer = function (discovery_server_endpointUrl,callback) {


    var OPCUAClientBase = require("../lib/client/client_base").OPCUAClientBase;

    var RegisterServerRequest  = require("../lib/register_server_service").RegisterServerRequest;
    var RegisterServerResponse = require("../lib/register_server_service").RegisterServerResponse;

    var self = this;
    assert(self.serverType, " must have a valid server Type");

    var client = new OPCUAClientBase();
    function disconnect(callback) {
        client.disconnect(callback);
    }
    client.connect(discovery_server_endpointUrl,function(err){
        if (!err) {

            var request = new RegisterServerRequest({
                server: {
                    serverUri: "request.serverUri",
                    productUri: "request.productUri",
                    serverNames: [ { locale: "en", text: "MyServerName"}],
                    serverType: self.serverType,
                    gatewayServerUri: null,
                    discoveryUrls: [
                    ],
                    semaphoreFilePath: null,
                    isOnline: false
                }
            });
            assert(request.requestHeader);
            client.performMessageTransaction(request,function(err,response){
                // RegisterServerResponse
                assert(response instanceof RegisterServerResponse);
                disconnect(callback);
            });
        } else {
            console.log(" cannot register server to discovery server " + discovery_server_endpointUrl);
            console.log("   " + err.message);
            console.log(" make sure discovery server is up and running.");
            disconnect(callback);

        }
    })
};


exports.OPCUAServerEndPoint = OPCUAServerEndPoint;
exports.OPCUAServer = OPCUAServer;



