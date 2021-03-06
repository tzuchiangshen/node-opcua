/**
 * @module opcua
 */

var assert = require('better-assert');
var ec = require("./encode_decode");
var util = require("util");
require('enum').register();
var _ = require("underscore");
var hexDump = require("./utils").hexDump;
var dumpIf = require("./utils").dumpIf;
var objectNodeIds = require("./opcua_node_ids").ObjectIds;
var sc = require("./opcua_status_code");
assert(sc.StatusCodes.Good.value==0);

var factories = {};
var _enumerations = {};

var  coerceNodeId = require("./nodeid").coerceNodeId;


exports.minDate=  new Date(Date.UTC(1601,0,1,0,0));

var _defaultType = [

    { name: "UAString", encode: ec.encodeUAString, decode: ec.decodeUAString, defaultValue: ""},
    { name: "String", encode: ec.encodeUAString, decode: ec.decodeUAString, defaultValue: ""},
    { name: "Byte", encode: ec.encodeByte, decode: ec.decodeByte, defaultValue: 0 },
    { name: "Integer", encode: ec.encodeInt32, decode: ec.decodeInt32, defaultValue: 0 },
    { name: "Int32", encode: ec.encodeInt32, decode: ec.decodeInt32, defaultValue: 0 },
    { name: "UInt32", encode: ec.encodeUInt32, decode: ec.decodeUInt32, defaultValue: 0 },
    { name: "Int16", encode: ec.encodeInt16, decode: ec.decodeInt16, defaultValue: 0 },
    { name: "UInt16", encode: ec.encodeUInt16, decode: ec.decodeUInt16, defaultValue: 0 },
    { name: "Double", encode: ec.encodeDouble, decode: ec.decodeDouble, defaultValue: 0.0 },
    { name: "Boolean", encode: ec.encodeBoolean, decode: ec.decodeBoolean, defaultValue: false },

    // OPC Unified Architecture, part 3.0 $8.13 page 65
    { name: "Duration", encode: ec.encodeDouble, decode: ec.decodeDouble, defaultValue: 0.0 },

    { name: "Float", encode: ec.encodeFloat, decode: ec.decodeFloat, defaultValue: 0.0 },

    // OPC Unified Architecture, part 3.0 $8.26 page 67
    { name: "UtcTime", encode: ec.encodeDateTime, decode: ec.decodeDateTime, defaultValue: exports.minDate },

    // OPC Unified Architecture, part 4.0 $7.13
    // IntegerID: This primitive data type is an UInt32 that is used as an identifier, such as a handle. All values,
    // except for 0, are valid.
    { name: "IntegerId", encode: ec.encodeUInt32, decode: ec.decodeUInt32, defaultValue: 0xFFFFFFFF },

    // string in the form "en-US" or "de-DE" or "fr" etc...
    { name: "LocaleId", encode: ec.encodeLocaleId, decode: ec.decodeLocaleId, validate: ec.validateLocaleId, defaultValue: "en" },

    { name: "NodeId", encode: ec.encodeNodeId, decode: ec.decodeNodeId, defaultValue: ec.makeNodeId , coerce: coerceNodeId },
    { name: "ExpandedNodeId", encode: ec.encodeExpandedNodeId, decode: ec.decodeExpandedNodeId, defaultValue: ec.makeExpandedNodeId },

    //The StatusCode is a 32-bit unsigned integer. The top 16 bits represent the numeric value of the
    //code that shall be used for detecting specific errors or conditions. The bottom 16 bits are bit flags
    //that contain additional information but do not affect the meaning of the StatusCode.
    // 7.33 Part 4 - P 143
    {
        name:"StatusCode",
        encode: sc.encodeStatusCode,
        decode: sc.decodeStatusCode,
        defaultValue: sc.StatusCodes.Good
    },


    { name: "ByteString", encode: ec.encodeByteString, decode: ec.decodeByteString, defaultValue: function () {
        return new Buffer(0);
    } },
    { name: "ExtensionObject", encode: encodeExtensionObject, decode: decodeExtensionObject, defaultValue: function () {
        return null;
    } }

];


// OPC-UA Part 6 - $5.2.2.15 ExtensionObject
// An ExtensionObject is encoded as sequence of bytes prefixed by the  NodeId of its
// DataTypeEncoding and the number of bytes encoded.
function encodeExtensionObject(object, stream) {

    if (!object) {
        ec.encodeNodeId(ec.makeNodeId(0), stream);
        stream.writeByte(0x00); // no body is encoded
        stream.writeUInt32(0);
    } else {
        ec.encodeNodeId(object.encodingDefaultBinary, stream);
        stream.writeByte(0x01); // 0x01 The body is encoded as a ByteString.
        stream.writeUInt32(object.binaryStoreSize());
        object.encode(stream);
    }
}

function decodeExtensionObject(stream) {

    var nodeId = ec.decodeNodeId(stream);
    var encodingType = stream.readByte();
    var length = stream.readUInt32();
    if (nodeId.value === 0 || encodingType === 0) {
        return null;
    }
    var object = exports.constructObject(nodeId);
    if (object === null) {
        // this object is unknown to us ..
        stream.length += length;
        return null;
    }
    object.decode(stream);
    return object;
}
exports.encodeExtensionObject = encodeExtensionObject;
exports.decodeExtensionObject = decodeExtensionObject;

var _defaultTypeMap = {};
_defaultType.forEach(function (d) {
    _defaultTypeMap[d.name] = d;
});

function registerType(name, encodeFunc, decodeFunc, defaultValue) {
    assert(_.isFunction(encodeFunc));
    assert(_.isFunction(decodeFunc));
    var obj = {
        name: name, encode: encodeFunc, decode: decodeFunc, defaultValue: defaultValue
    };
    _defaultType.push(obj);
    _defaultTypeMap[name] = obj;
}


var constructorMap = {};


exports.findSimpleType = function findSimpleType(name) {
    assert (name in _defaultTypeMap);
    return _defaultTypeMap[name];
};


function _encode_by_type(obj, fieldType, stream) {
    try {
        var _t = _defaultTypeMap[fieldType];
        _t.encode(obj, stream);
    }
    catch (err) {
        console.error("ERROR in  _encode_by_type  ".red + "cannot encode " + fieldType + " on " + util.inspect(obj));
        console.error(util.inspect(err));
        console.error(err.stack);
    }
}

function _decode_by_type(obj, fieldType, stream) {
    var _t = _defaultTypeMap[fieldType];
    if (!_t.hasOwnProperty("decode") || (!_t.decode instanceof Function)) {
        console.error(" _decode_by_type :" , util.inspect(_t), util.inspect(obj));
    }
    return  _t.decode(stream);
}

function _encode_member_(member, fieldType, stream) {

    assert(fieldType);

    if (_defaultTypeMap[fieldType]) {

        _encode_by_type(member, fieldType, stream);

    } else if (factories[fieldType]) {
        if (!member) {
            console.error(" cannot find encode method on type  " + fieldType);
        }
        if (!member.encode) {
        }
        member.encode(stream);

    } else if (_enumerations[fieldType]) {
        // OPC Unified Architecture, Part 3 page 34
        // Enumerations are always encoded as Int32 on the wire as defined in Part 6.
        stream.writeInteger(member.value);

    } else {

        throw new Error(" Invalid field" + fieldType);
    }
}

function _decode_member_(member, fieldType, stream, options) {

    var tracer = options ? options.tracer : null;

    var cursor_before = stream.length;


    if (_defaultTypeMap[fieldType]) {

        member = _decode_by_type(member, fieldType, stream);
        if (tracer) {
            tracer.trace("member", options.name, member, cursor_before, stream.length,fieldType);
        }

        return member;

    } else if (factories[fieldType]) {

        //xx console.log(" decoding fieldType=",fieldType);
        member.decode(stream, options);

    } else if (_enumerations[fieldType]) {

        var typedEnum = _enumerations[fieldType].typedEnum;
        member = typedEnum.get(stream.readInteger());
        if (tracer) {
            tracer.trace("member", options.name, member, cursor_before, stream.length,fieldType);
        }
        return member;

    } else {

        throw new Error(" Invalid field" + field.fieldType);
    }
    return member;
}

function _encode_(obj, objDesc, stream) {

    assert( objDesc );
    assert( objDesc.fields,"where are the fields ?"+ util.inspect(objDesc));
    objDesc.fields.forEach(function (field) {

        if (obj.hasOwnProperty(field.name)) {

            var member = obj[field.name];
            var fieldType = field.fieldType;
            if (_.isArray(member)) {

                stream.writeUInt32(member.length);
                member.forEach(function (element) {
                    _encode_member_(element, fieldType, stream);
                });
            } else {
                _encode_member_(member, fieldType, stream);
            }

        } else {
            throw new Error(" Missing field " + field.name + " in object " + util.inspect(obj));
        }
    });
}

function _resolve_defaultValue(type_userValue, defaultValue) {
    defaultValue = defaultValue || type_userValue;
    if (_.isFunction(defaultValue)) {
        defaultValue = defaultValue.call();
    }
    // this is a default type such as UAString or Integer
    return  defaultValue;
}

function _build_default_value(field, options) {

    var fieldType = field.fieldType;
    var  _constructor;

    if (_defaultTypeMap[fieldType]) {

        var _type = _defaultTypeMap[fieldType];
        return _resolve_defaultValue(_type.defaultValue, options);

    } else if (factories[fieldType]) {

        _constructor = factories[fieldType];
        return callConstructor(_constructor, options);
    }
    return;
}

function _decode_(obj, objDesc, stream, options) {

    var tracer = options ? options.tracer : null;

    if (tracer) {
        tracer.trace("start", options.name + "(" + objDesc.name + ")", stream.length, stream.length);
    }

    objDesc.fields.forEach(function (field) {

        if (obj.hasOwnProperty(field.name)) {

            var member = obj[field.name];
            var fieldType = field.fieldType;

            if (_.isArray(member)) {

                assert(member.length === 0);

                var cursor_before = stream.length;
                var nb = stream.readUInt32();

                if (nb === 0xFFFFFFFF) {
                    nb = 0;
                }

                if (options) {
                    options.name = field.name + []
                }

                if (tracer) { tracer.trace("start_array", field.name, nb, cursor_before, stream.length); }

                for (var i = 0; i < nb; i++) {
                    var element = _build_default_value(field,{});

                    if (tracer) {tracer.trace("start_element", field.name, i); }

                    options = options ||{};
                    options.name = "element #" + i;
                    element = _decode_member_(element, fieldType, stream, options) || member;
                    member.push(element);

                    if (tracer) { tracer.trace("end_element", field.name, i);}

                }
                if (tracer) { tracer.trace("end_array", field.name, stream.length - 4); }

            } else {
                if (options) {
                    options.name = field.name;
                }
                obj[field.name] = _decode_member_(member, fieldType, stream, options) || member;
            }

        }
    });

    if (tracer) { tracer.trace("end", objDesc.name, stream.length, stream.length);    }
}


function installEnumProp(obj, name, Enum) {

    var private_name = "__" + name;
    obj[private_name] = Enum.enums[0];

    assert(!_.isFunction(obj[name]),'enum has alrady been installed cannot do it !!!');
    assert(!Object.getOwnPropertyDescriptor(obj,name));

    // create a array of possible value for the enum
    var param = {};

    param[name] = {
        set: function (value) {
            if (!(value in Enum )) {
                throw "Invalid value provided for Enum " + name + ": " + value;
            }
            this[private_name] = value;
        },
        get: function () {
            return this[private_name];
        },
        enumerable: true

    };
    Object.defineProperties(obj, param);
    Object.defineProperty(obj, private_name, { hidden: true, enumerable: false});
}

exports.installEnumProp = installEnumProp;

function callConstructor(constructor) {
    var factoryFunction = constructor.bind.apply(constructor, arguments);
    return new factoryFunction();
}


/**
 * return the initial value of a constructed field.
 *
 *   if the field is not specified in the options, the default value will be used
 *
 * @param field
 * @param options
 * @private
 */
function _install_initial_value(field,options) {

    if (field.isArray) {
        var arr = [];
        if (options[field.name]) {
            assert(_.isArray(options[field.name]));
            options[field.name].forEach(function(el){
                var init_data = {};
                init_data[field.name]=el;
                var value =___install_single_initial_value(field,init_data);
                arr.push(value);
            });
        }
        return arr;
    }
    return ___install_single_initial_value(field,options);
}

function ___install_single_initial_value(field,options) {

    dumpIf(! (typeof(options) === "object"), { field: field , options: options} );
    assert( (typeof(options) === "object") ," expecting options for field " + util.inspect(field));
    var value = null;

    var typeDef = _defaultTypeMap[field.fieldType];

    var defaultValue = field.defaultValue;
    if (defaultValue === undefined ) {
        if (typeDef) {
            defaultValue = typeDef.defaultValue;
        }
    }

    //xx console.log(options);
    if ( field.name in options ) {
        // the user has specified a value for this field
        value = options[field.name ];
    } else {
        // let fall back to the default value
        if (_.isFunction(defaultValue)) {
            value = defaultValue.call();
        } else {
            value = defaultValue;
        }
    }
    // there is a coercion method  for this field, use it
    if (field.coerce) {
        value = field.coerce(value);
    } else if (typeDef && typeDef.coerce) {
        value = typeDef.coerce(value);
    }
    return value;

}

var constructObject = function (kind_of_field, self, field, extra, data) {
    var fieldType = field.fieldType;
    var fieldName = field.name;
    var options = data.options;

    switch (kind_of_field) {

        case "enumeration":
            var typedEnum = _enumerations[fieldType].typedEnum;
            installEnumProp(self, fieldName, typedEnum);
            if (!field.defaultValue) {
                field.defaultValue =typedEnum.enums[0];
            }
            self[fieldName] = _install_initial_value(field,data.options);

            break;
        case "basic":
            self[fieldName] = _install_initial_value(field,data.options);
            break;
        case "complex":
            var _constructor = factories[fieldType];

            if (field.isArray) {
                var arr = [];
                if (options[field.name]) {
                    assert(_.isArray(options[field.name]));
                    options[field.name].forEach(function(initializing_value){
                        arr.push(callConstructor(_constructor, initializing_value));
                    });
                }
                self[fieldName] = arr;

            } else {
                assert(!field.isArray);
                var initializing_value = options[fieldName];
                if (!initializing_value  &&   field.defaultValue === null) {
                    self[fieldName] = null;
                } else {
                    initializing_value = initializing_value || {};
                    self[fieldName]  = callConstructor(_constructor, initializing_value);
                }
            }
            break;
        default:
            throw new Error("internal error kind_of_field");
    }
};


function r(str) {
    return (str + "                                ").substr(0, 30);
}

var _exploreObject = function (kind_of_field, self, field, extra, data) {

    assert(self);

    var fieldType = field.fieldType;
    var fieldName = field.name;
    var padding = data.padding;
    var value = self[fieldName];
    var str;

    switch (kind_of_field) {

        case "enumeration":
            //xx var typedEnum = _enumerations[fieldType].typedEnum;
            str = r(padding + fieldName, 30) + " " + r(fieldType, 15) + " " + value.key + " ( " + value.value + ")";
            data.lines.push(str);
            break;

        case "basic":
            if (value instanceof Buffer) {

                var _hexDump = hexDump(value);
                value = "<BUFFER>";
                data.lines.push(r(padding + fieldName, 30) + " " + r(fieldType, 15));
                data.lines.push(_hexDump);
            } else {
                if (fieldType === "IntegerId" || fieldType === "UInt32") {
                    value = "" + value + "               0x" + value.toString(16);
                }
                str = r(padding + fieldName, 30) + " " + r(fieldType, 15) + " " + value;
                data.lines.push(str);
            }
            break;

        case "complex":
            if (field.subtype) {
                // this is a synonymous
                fieldType = field.subType;
                str = r(padding + fieldName, 30) + " " + r(fieldType, 15) + " " + value;
                data.lines.push(str);
            } else {

                var _new_desc = factories[fieldType].prototype._schema;
                if (field.isArray) {
                    data.lines.push(r(padding + fieldName, 30) + r(fieldType, 15) + ': [');
                    var i = 0;
                    value.forEach(function (element) {
                        var data1 = { padding: padding + " ", lines: []};
                        objectVisitor(element, _new_desc, data1, _exploreObject);
                        data.lines.push(padding + i + ": {");
                        data.lines = data.lines.concat(data1.lines);
                        data.lines.push(padding + "}");
                        i++;
                    });

                    data.lines.push(r(padding + "", 30) + "]");
                } else {
                    data.lines.push(r(padding + fieldName, 30) + r(fieldType, 15) + "{");
                    var data1 = { padding: padding + "  ", lines: []};
                    objectVisitor(value, _new_desc, data1, _exploreObject);
                    data.lines = data.lines.concat(data1.lines);
                    data.lines.push(padding + "}")
                }
            }

            break;
        default:
            throw new Error("internal error: unknown kind_of_field");
    }
};




var objectVisitor = function (self, schema, data, callback) {

    assert(schema);
    // ignore null objects
    if (!self) { return;  }

    schema.fields.forEach(function (field) {

        var fieldType = field.fieldType;

        if (fieldType in _enumerations) {

            var typedEnum = _enumerations[fieldType].typedEnum;
            callback("enumeration", self, field, typedEnum, data);

        } else if (fieldType in _defaultTypeMap) {

            callback("basic", self, field, null, data);

        } else if (fieldType in factories) {
            callback("complex", self, field, null, data);

        } else {
            console.error(schema);
            console.error("field = ",field);
            throw new Error("Invalid field type : " + fieldType + JSON.stringify(field) + " is not a default type nor a registered complex struct");
        }
    });

};


function check_options_correctness_against_schema(schema, options) {
   // check correctness of option fields
    var possible_fields = schema.fields.map(function (field) {
        return field.name;
    });
    var current_fields = Object.keys(options);
    var invalid_options_fields = _.difference(current_fields, possible_fields);
    if (invalid_options_fields.length > 0) {
        var err = new Error();
        console.log("expected schema", schema.name);
        require("./utils").display_trace_from_this_projet_only();
        console.log("invalid_options_fields= ", invalid_options_fields);
    }
    assert(invalid_options_fields.length === 0 && " invalid field found in option");
}


/**
 * base constructor for all OPC-UA objects
 * OPC-UA objects are created against a schema and provide binary encode/decode facilities.
 * @class BaseObject
 *
 * @constructor
 */
function BaseObject(schema,options) {

    assert((this instanceof BaseObject)&& " keyword 'new' is required for constructor call");
    assert(schema.name && " expecting schema to have a name");
    assert(schema.fields &&  " expecting schema to provide a set of fields " + schema.name);

    var self = this;
    assert(this.__proto__._schema === schema);
    assert(this._schema === schema);


    if (schema.construct_hook) {
        options =  schema.construct_hook.call(this,options);
    };

    options = options || {};
    check_options_correctness_against_schema(schema, options);

    var data = {
        options: options,
        sub_option_to_ignore: []
    };
    objectVisitor(self, schema, data, constructObject);

    // Prevents code from adding or deleting properties, or changing the descriptors of any property on an object.
    // Property values can be changed however.
    Object.seal(this);
}

/**
 * Calculate the required size to store this object in a binary stream.
 * @method binaryStoreSize
 * @returns {number}
 */
BaseObject.prototype.binaryStoreSize = function () {

    var BinaryStreamSizeCalculator = require("../lib/binaryStream").BinaryStreamSizeCalculator;
    var stream = new BinaryStreamSizeCalculator();
    this.encode(stream);
    return stream.length;
};

/**
 * encode the object in a stream
 * @method encode
 * @param stream {BinaryStream}
 */
BaseObject.prototype.encode = function(stream) {

    assert(this._schema);
    if (this._schema.encode) {
        // use the encode function specified in the description object instead of default one
        this._schema.encode(this, stream);
    } else {
        _encode_(this, this._schema, stream);
    }
};

/**
 * decode the object in a stream
 * @method decode
 * @param stream  {BinaryStream}
 * @param options
 */
BaseObject.prototype.decode = function (stream, options) {
    assert(this._schema);
    if (this._schema.decode) {
        // use the decode function specified in the description object instead of default one
        this._schema.decode(this, stream, options);
    } else {
        _decode_(this, this._schema, stream, options);
    }
};

/**
 * @method toString
 * @returns {string}
 */
BaseObject.prototype.toString = function () {
    assert(this._schema);
    if (this._schema.toString) {
        return this._schema.toString.apply(this,arguments);
    } else {
        return Object.toString.apply(this,arguments);
    }
};

/**
 * verify that all object attributes values are valid according to schema
 * @method isValid
 * @returns {string}
 */
BaseObject.prototype.isValid = function () {
    assert(this._schema);
    if (this._schema.toString) {
        return this._schema.isValid.apply(this,arguments);
    } else {
        return true;
    }
};

/**
 *
 *
 */
BaseObject.prototype.explore =  function () {
    var self = this;
    var data = { padding: " ", lines: []};
    data.lines.push("message /*" + this._schema.name + "*/ : {");
    objectVisitor(self, self._schema, data, _exploreObject);
    data.lines.push(" };");
    return data.lines.join("\n");
};


/**
 * register a new type of object in the factory
 * @param schema {Schema} the class schema
 * @returns {Function} the created class constructor
 */
function registerObject(schema) {

    var name = schema.name;

    if (schema.hasOwnProperty("isEnum")) {
        // create a new Enum
        var typedEnum = new Enum(schema.enumValues);
        // xx if ( name in enumerations) { throw " already inserted"; }
        _enumerations[name] = schema;
        _enumerations[name].typedEnum = typedEnum;
        return typedEnum;
    }

    if (schema.hasOwnProperty("subtype")) {

        var t = _defaultTypeMap[schema.subtype];
        assert (t !== undefined," " + util.inspect(schema, {color: true}) + " cannot find subtype " + schema.subtype);
        assert(_.isFunction(t.encode));
        assert(_.isFunction(t.decode));
        registerType(name, t.encode, t.decode, t.defaultValue);
        return;
    }

    assert( !(name in factories), " Class " + name + " already in factories");

    // check the unique id of the object
    var id = schema.id;
    if (!id) {
        var encode_name = name + "_Encoding_DefaultBinary";
        id =  objectNodeIds[encode_name];
    }
    assert(id, "" + name + " has no _Encoding_DefaultBinary id\nplease add a Id field in the structure definition");

    var expandedNodeId = ec.makeExpandedNodeId(id);

    var ClassConstructor = function (options) {
        assert((this instanceof BaseObject)&& " keyword 'new' is required for constructor call");
        BaseObject.call(this,schema,options);
    };
    util.inherits(ClassConstructor,BaseObject);

    ClassConstructor.prototype.encodingDefaultBinary = expandedNodeId;
    ClassConstructor.prototype.constructor.name = name;
    ClassConstructor.prototype._schema = schema;

    factories[name] = ClassConstructor;

    assert(!(expandedNodeId.value in constructorMap)," Class " + name + " with ID  " + expandedNodeId.value + " already in constructorMap");
    constructorMap[expandedNodeId.value] = ClassConstructor;
    return ClassConstructor;
}
exports.registerObject = registerObject;

registerObject({name:"Counter",subtype:"UInt32"});


var getConstructor = function (expandedId) {
    if (!(expandedId && (expandedId.value in constructorMap))) {
        console.log( "cannot find constructor for expandedId ".red.bold);
        console.log(expandedId);
    }
    return constructorMap[expandedId.value];
};

exports.constructObject = function (expandedId) {
    var constructor = getConstructor(expandedId);
    if (!constructor) return null;
    return new constructor();
};


var _next_available_id = 0xFFFE0000;
exports.next_available_id = function(){
    _next_available_id +=1;
    return _next_available_id;
};
