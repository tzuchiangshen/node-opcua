/**
 * @module utilities
 */
var assert = require('better-assert');
var util   = require("util");

/**
 * a BinaryStream can be use to perform sequential read or write
 * inside a buffer.
 * The BinaryStream maintains a cursor up to date as the caller
 * operates on the stream using the various read/write methods. 
 * It uses the [Little Endian](http://en.wikipedia.org/wiki/Little_endian#Little-endian) 
 * convention.
 *
 * data can either be:
 *
 * * a Buffer , in this case the BinaryStream operates on this Buffer
 * * null     , in this case a BinaryStream with 1024 bytes is created
 * * any data , in this case the object is converted into a binary buffer. 
 *
 * example:
 *
 *    ``` javascript
 *    var stream = new BinaryStream(new Buffer(32))
 *    ```
 *
 * @class BinaryStream
 * @param {null|Buffer|*} data
 * @constructor
 *
 *
 *
 */
function BinaryStream(data) {
    if (data === undefined) {
        this._buffer = new Buffer(1024);
    } else {
        if (data instanceof Buffer) {
            this._buffer = data;
        } else {
            this._buffer = new Buffer(data, "binary");
        }
    }
    this.length = 0;
}

/**
 * set the cursor to the begining of the stream
 * @method BinaryStream.rewind 
 * @returns null 
 */
BinaryStream.prototype.rewind = function () {
    this.length = 0;
};

/**
 * write a single signed byte (8 bits) to the stream.
 * value must be in the range of [-127,128]
 * @method writeByte
 * @param {integer} value
 */
BinaryStream.prototype.writeByte = function (value) {
    assert(value >-127 && value < 128);
    this._buffer.writeInt8(value, this.length);
    this.length += 1;
};

/**
 * write a single unsigned byte (8 bits) to the stream.
 * @method writeByte
 * @param {integer} value
 * @param value
 */
BinaryStream.prototype.writeUInt8 = function (value) {
    assert(value >= 0 && value < 256 , " writeUInt8 : out of bound " +value);
    this._buffer.writeUInt8(value, this.length);
    this.length += 1;
};

/**
 * write a single 16 bit signed integer to the stream.
 * @method writeInt16
 * @param {integer} value
 */
BinaryStream.prototype.writeInt16 = function (value) {
    this._buffer.writeInt16LE(value, this.length);
    this.length += 2;
};

/**
 * write a single 16 bit unsigned integer to the stream.
 * @method writeUInt16
 * @param value
 */
BinaryStream.prototype.writeUInt16 = function (value) {
    this._buffer.writeUInt16LE(value, this.length);
    this.length += 2;
};


/**
 * write a single 32 bit signed integer to the stream.
 * @method writeInteger
 * @param value
 */
BinaryStream.prototype.writeInteger = function (value) {
    this._buffer.writeInt32LE(value, this.length);
    this.length += 4;
};

/**
 * write a single 32 bit unsigned integer to the stream.
 * @method writeUInt32
 * @param value
 */
BinaryStream.prototype.writeUInt32 = function (value) {
    this._buffer.writeUInt32LE(value, this.length);
    this.length += 4;
};

/**
 * write a single 32 bit floating number to the stream.
 * @method writeFloat
 * @param value
 */
BinaryStream.prototype.writeFloat = function (value) {
    this._buffer.writeFloatLE(value, this.length);
    this.length += 4;
};

/**
 * write a single 64 bit floating number to the stream.
 * @method writeDouble
 * @param value
 */
BinaryStream.prototype.writeDouble = function (value) {
    this._buffer.writeDoubleLE(value, this.length);
    this.length += 8;
};

/**
 * read a single signed byte  (8 bits) from the stream.
 * @method readByte
 * @returns {Number}
 */
BinaryStream.prototype.readByte = function () {
    var retVal = this._buffer.readInt8(this.length);
    this.length += 1;
    return retVal;
};

/**
 * read a single unsigned byte (8 bits) from the stream.
 * @method readUInt8
 * @returns {Number}
 */
BinaryStream.prototype.readUInt8 = function () {
    var retVal = this._buffer.readUInt8(this.length);
    this.length += 1;
    return retVal;
};

/**
 * read a single signed 16-bit integer from the stream.
 * @method readInt16
 * @returns {Number}
 */
BinaryStream.prototype.readInt16 = function () {
    var retVal = this._buffer.readInt16LE(this.length);
    this.length += 2;
    return retVal;
};

/**
 * read a single unsigned 16-bit integer from the stream.
 * @method readUInt16
 * @returns {Number}  q
 */
BinaryStream.prototype.readUInt16 = function () {
    var retVal = this._buffer.readUInt16LE(this.length);
    this.length += 2;
    return retVal;
};

/**
 * read a single signed 32-bit integer from the stream.
 * @method readInteger
 * @returns {Number}
 */
BinaryStream.prototype.readInteger = function () {
    var retVal = this._buffer.readInt32LE(this.length);
    this.length += 4;
    return retVal;
};

/**
 * read a single unsigned 32-bit integer from the stream.
 * @method readUInt32
 * @returns {Number} the value read from the stream
 */
BinaryStream.prototype.readUInt32 = function () {
    var retVal = this._buffer.readUInt32LE(this.length);
    this.length += 4;
    return retVal;
};

/**
 * read a single  32-bit floating point number from the stream.
 * @method readFloat
 * @returns {Number} the value read from the stream
 */
BinaryStream.prototype.readFloat = function () {
    var retVal = this._buffer.readFloatLE(this.length);
    this.length += 4;
    return retVal;
};

/**
 * read a single 64-bit floating point number from the stream.
 * @method readDouble
 * @returns {Number} the value read from the stream
 */
BinaryStream.prototype.readDouble = function () {
    var retVal = this._buffer.readDoubleLE(this.length);
    this.length += 8;
    return retVal;
};

/**
 * write a set of byte to the stream
 *
 * @method writeRaw
 * @param {buffer} buf the buffer to write
 * @param length   the number of byte to write
 */
BinaryStream.prototype.writeRaw = function(buf,length) {

    this._buffer.write(buf,this.length,length);
    this.length += length;
};

/**
 * write a byte stream to the stream.
 * The method writes the length of the byte array into the stream as a 32 bits integer before the byte stream.
 *
 * @method writeByteStream
 * @param {Buffer} buf the    buffer to write.
 *   the buffer buf.length the buffer to write
 */
BinaryStream.prototype.writeByteStream = function (buf) {

    if (!buf) {
        this.writeUInt32(0xFFFFFFFF);
        return;
    }
    var bufLen = buf.length;
    this.writeUInt32(buf.length);
    buf.copy(this._buffer, this.length,0,buf.length);
    this.length += bufLen;
};


/**
 * read a byte stream to the stream.
 * The method reads the length of the byte array from the stream as a 32 bits integer before reading the byte stream.
 *
 * @method readByteStream
 * @return {Buffer}
 */
BinaryStream.prototype.readByteStream = function () {
    var bufLen = this.readUInt32();
    if (bufLen === 0xFFFFFFFF) {
        return null;
    }
    if (bufLen === 0) {
        return new Buffer(0);
    }
    var buf = new Buffer(bufLen);
    this._buffer.copy(buf,0,this.length,this.length+ bufLen);
    this.length += bufLen;
    return buf;
};

exports.BinaryStream = BinaryStream;




/**
 * a BinaryStreamSizeCalculator can be used to quickly evaluate the required size
 * of a buffer by performing the same sequence of write operation.
 *
 * a BinaryStreamSizeCalculator has the same writeXXX methods as the BinaryStream stream 
 * object.
 *
 * @class BinaryStreamSizeCalculator
 * @extends BinaryStream
 * @constructor
 *
 */
function BinaryStreamSizeCalculator() {
    this.length = 0;
}

BinaryStreamSizeCalculator.prototype.rewind = function () {
    this.length = 0;
};

BinaryStreamSizeCalculator.prototype.writeByte = function (value) {
    this.length += 1;
};

BinaryStreamSizeCalculator.prototype.writeUInt8 = function (value) {
    this.length += 1;
};

BinaryStreamSizeCalculator.prototype.writeInt16 = function (value) {
    this.length += 2;
};

BinaryStreamSizeCalculator.prototype.writeInteger = function (value) {
    this.length += 4;
};

BinaryStreamSizeCalculator.prototype.writeUInt32 = function (value) {
    this.length += 4;
};

BinaryStreamSizeCalculator.prototype.writeUInt16 = function (value) {
    this.length += 2;
};

BinaryStreamSizeCalculator.prototype.writeFloat = function (value) {
    this.length += 4;
};

BinaryStreamSizeCalculator.prototype.writeDouble = function (value) {
    this.length += 8;
};

BinaryStreamSizeCalculator.prototype.writeByteStream = function (buf) {
    if(!buf) {
        this.writeUInt32(0);
    }else {
        this.writeUInt32(buf.length);
        this.length += buf.length;

    }
};
BinaryStreamSizeCalculator.prototype.writeRaw = function (buf,length) {
    this.length += length;
};


exports.BinaryStreamSizeCalculator = BinaryStreamSizeCalculator;
