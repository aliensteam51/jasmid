(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.jasmid = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var sampleRate = 44100
module.exports.sampleRate = sampleRate

/* AudioPlayer */
module.exports.AudioPlayer = function AudioPlayer (generator, opts) {
  if (!opts) opts = {}
  var latency = opts.latency || 1
  var checkInterval = latency * 100 /* in ms */

  var audioElement = new Audio()
  var webkitAudio = window.AudioContext || window.webkitAudioContext
  var requestStop = false

  if (audioElement.mozSetup) {
    audioElement.mozSetup(2, sampleRate); /* channels, sample rate */

    var buffer = [] /* data generated but not yet written */
    var minBufferLength = latency * 2 * sampleRate /* refill buffer when there are only this many elements remaining */
    var bufferFillLength = Math.floor(latency * sampleRate)

    function checkBuffer () {
      if (buffer.length) {
        var written = audioElement.mozWriteAudio(buffer)
        buffer = buffer.slice(written)
      }
      if (buffer.length < minBufferLength && !generator.finished) {
        buffer = buffer.concat(generator.generate(bufferFillLength))
      }
      if (!requestStop && (!generator.finished || buffer.length)) {
        setTimeout(checkBuffer, checkInterval)
      }
    }
    checkBuffer()

    return {
      'type': 'Firefox Audio',
      'stop': function () {
        requestStop = true
      }
    }
  } else if (webkitAudio) {
    // Uses Webkit Web Audio API if available
    var context = new webkitAudio()
    sampleRate = context.sampleRate

    var channelCount = 2
    var bufferSize = 4096 * 4; // Higher for less gitches, lower for less latency

    var node = context.createScriptProcessor(bufferSize, 0, channelCount)

    node.onaudioprocess = function (e) { process(e) }

    function process (e) {
      if (generator.finished) {
        node.disconnect()
        return
      }

      var dataLeft = e.outputBuffer.getChannelData(0)
      var dataRight = e.outputBuffer.getChannelData(1)

      var generate = generator.generate(bufferSize)

      for (var i = 0; i < bufferSize; ++i) {
        dataLeft[i] = generate[i * 2]
        dataRight[i] = generate[i * 2 + 1]
      }
    }

    // start
    node.connect(context.destination)

    return {
      'stop': function () {
        // pause
        node.disconnect()
        requestStop = true
      },
      'type': 'Webkit Audio'
    }

  } else {
    // No further fallbacks available
    console.warn('Unable to setup Jasmid audio')

  }
}

},{}],2:[function(require,module,exports){
module.exports.Audio = require('./audio')
module.exports.MidiFile = require('./midifile')
module.exports.Replayer = require('./replayer')
module.exports.Stream = require('./stream')
module.exports.Synth = require('./synth')

},{"./audio":1,"./midifile":3,"./replayer":4,"./stream":5,"./synth":6}],3:[function(require,module,exports){
var Stream = require('./stream')

/*
class to parse the .mid file format
(depends on stream.js)
*/
module.exports = function MidiFile (data) {
  function readChunk (stream) {
    var id = stream.read(4)
    var length = stream.readInt32()
    return {
      'id': id,
      'length': length,
      'data': stream.read(length)
    }
  }

  var lastEventTypeByte

  function readEvent (stream) {
    var event = {}
    event.deltaTime = stream.readVarInt()
    var eventTypeByte = stream.readInt8()
    if ((eventTypeByte & 0xf0) == 0xf0) {
      /* system / meta event */
      if (eventTypeByte == 0xff) {
        /* meta event */
        event.type = 'meta'
        var subtypeByte = stream.readInt8()
        var length = stream.readVarInt()
        switch (subtypeByte) {
          case 0x00:
            event.subtype = 'sequenceNumber'
            if (length != 2) throw 'Expected length for sequenceNumber event is 2, got ' + length
            event.number = stream.readInt16()
            return event
          case 0x01:
            event.subtype = 'text'
            event.text = stream.read(length)
            return event
          case 0x02:
            event.subtype = 'copyrightNotice'
            event.text = stream.read(length)
            return event
          case 0x03:
            event.subtype = 'trackName'
            event.text = stream.read(length)
            return event
          case 0x04:
            event.subtype = 'instrumentName'
            event.text = stream.read(length)
            return event
          case 0x05:
            event.subtype = 'lyrics'
            event.text = stream.read(length)
            return event
          case 0x06:
            event.subtype = 'marker'
            event.text = stream.read(length)
            return event
          case 0x07:
            event.subtype = 'cuePoint'
            event.text = stream.read(length)
            return event
          case 0x20:
            event.subtype = 'midiChannelPrefix'
            if (length != 1) throw 'Expected length for midiChannelPrefix event is 1, got ' + length
            event.channel = stream.readInt8()
            return event
          case 0x2f:
            event.subtype = 'endOfTrack'
            if (length != 0) throw 'Expected length for endOfTrack event is 0, got ' + length
            return event
          case 0x51:
            event.subtype = 'setTempo'
            if (length != 3) throw 'Expected length for setTempo event is 3, got ' + length
            event.microsecondsPerBeat = (
              (stream.readInt8() << 16)
              + (stream.readInt8() << 8)
              + stream.readInt8()
            )
            return event
          case 0x54:
            event.subtype = 'smpteOffset'
            if (length != 5) throw 'Expected length for smpteOffset event is 5, got ' + length
            var hourByte = stream.readInt8()
            event.frameRate = {
              0x00: 24, 0x20: 25, 0x40: 29, 0x60: 30
            }[hourByte & 0x60]
            event.hour = hourByte & 0x1f
            event.min = stream.readInt8()
            event.sec = stream.readInt8()
            event.frame = stream.readInt8()
            event.subframe = stream.readInt8()
            return event
          case 0x58:
            event.subtype = 'timeSignature'
            if (length != 4) throw 'Expected length for timeSignature event is 4, got ' + length
            event.numerator = stream.readInt8()
            event.denominator = Math.pow(2, stream.readInt8())
            event.metronome = stream.readInt8()
            event.thirtyseconds = stream.readInt8()
            return event
          case 0x59:
            event.subtype = 'keySignature'
            if (length != 2) throw 'Expected length for keySignature event is 2, got ' + length
            event.key = stream.readInt8(true)
            event.scale = stream.readInt8()
            return event
          case 0x7f:
            event.subtype = 'sequencerSpecific'
            event.data = stream.read(length)
            return event
          default:
            // console.log("Unrecognised meta event subtype: " + subtypeByte)
            event.subtype = 'unknown'
            event.data = stream.read(length)
            return event
        }
        event.data = stream.read(length)
        return event
      } else if (eventTypeByte == 0xf0) {
        event.type = 'sysEx'
        var length = stream.readVarInt()
        event.data = stream.read(length)
        return event
      } else if (eventTypeByte == 0xf7) {
        event.type = 'dividedSysEx'
        var length = stream.readVarInt()
        event.data = stream.read(length)
        return event
      } else {
        throw 'Unrecognised MIDI event type byte: ' + eventTypeByte
      }
    } else {
      /* channel event */
      var param1
      if ((eventTypeByte & 0x80) == 0) {
        /* running status - reuse lastEventTypeByte as the event type.
        	eventTypeByte is actually the first parameter
        */
        param1 = eventTypeByte
        eventTypeByte = lastEventTypeByte
      } else {
        param1 = stream.readInt8()
        lastEventTypeByte = eventTypeByte
      }
      var eventType = eventTypeByte >> 4
      event.channel = eventTypeByte & 0x0f
      event.type = 'channel'
      switch (eventType) {
        case 0x08:
          event.subtype = 'noteOff'
          event.noteNumber = param1
          event.velocity = stream.readInt8()
          return event
        case 0x09:
          event.noteNumber = param1
          event.velocity = stream.readInt8()
          if (event.velocity == 0) {
            event.subtype = 'noteOff'
          } else {
            event.subtype = 'noteOn'
          }
          return event
        case 0x0a:
          event.subtype = 'noteAftertouch'
          event.noteNumber = param1
          event.amount = stream.readInt8()
          return event
        case 0x0b:
          event.subtype = 'controller'
          event.controllerType = param1
          event.value = stream.readInt8()
          return event
        case 0x0c:
          event.subtype = 'programChange'
          event.programNumber = param1
          return event
        case 0x0d:
          event.subtype = 'channelAftertouch'
          event.amount = param1
          return event
        case 0x0e:
          event.subtype = 'pitchBend'
          event.value = param1 + (stream.readInt8() << 7)
          return event
        default:
          throw 'Unrecognised MIDI event type: ' + eventType
      /*
      console.log("Unrecognised MIDI event type: " + eventType)
      stream.readInt8()
      event.subtype = 'unknown'
      return event
      */
      }
    }
  }

  stream = Stream(data)
  var headerChunk = readChunk(stream)
  if (headerChunk.id != 'MThd' || headerChunk.length != 6) {
    throw 'Bad .mid file - header not found'
  }
  var headerStream = Stream(headerChunk.data)
  var formatType = headerStream.readInt16()
  var trackCount = headerStream.readInt16()
  var timeDivision = headerStream.readInt16()

  if (timeDivision & 0x8000) {
    throw 'Expressing time division in SMTPE frames is not supported yet'
  } else {
    ticksPerBeat = timeDivision
  }

  var header = {
    'formatType': formatType,
    'trackCount': trackCount,
    'ticksPerBeat': ticksPerBeat
  }
  var tracks = []
  for (var i = 0; i < header.trackCount; i++) {
    tracks[i] = []
    var trackChunk = readChunk(stream)
    if (trackChunk.id != 'MTrk') {
      throw 'Unexpected chunk - expected MTrk, got ' + trackChunk.id
    }
    var trackStream = Stream(trackChunk.data)
    while (!trackStream.eof()) {
      var event = readEvent(trackStream)
      tracks[i].push(event)
    // console.log(event)
    }
  }

  return {
    'header': header,
    'tracks': tracks
  }
}

},{"./stream":5}],4:[function(require,module,exports){
/* Replayer */
module.exports = function Replayer (midiFile, synth) {
  var trackStates = []
  var beatsPerMinute = 120
  var ticksPerBeat = midiFile.header.ticksPerBeat
  var channelCount = 16

  for (var i = 0; i < midiFile.tracks.length; i++) {
    trackStates[i] = {
      'nextEventIndex': 0,
      'ticksToNextEvent': (
      midiFile.tracks[i].length ?
        midiFile.tracks[i][0].deltaTime :
        null
      )
    }
  }

  function Channel () {
    var generatorsByNote = {}
    var currentProgram = PianoProgram

    function noteOn (note, velocity) {
      if (generatorsByNote[note] && !generatorsByNote[note].released) {
        /* playing same note before releasing the last one. BOO */
        generatorsByNote[note].noteOff(); /* TODO: check whether we ought to be passing a velocity in */
      }
      generator = currentProgram.createNote(note, velocity)
      synth.addGenerator(generator)
      generatorsByNote[note] = generator
    }
    function noteOff (note, velocity) {
      if (generatorsByNote[note] && !generatorsByNote[note].released) {
        generatorsByNote[note].noteOff(velocity)
      }
    }
    function setProgram (programNumber) {
      currentProgram = PROGRAMS[programNumber] || PianoProgram
    }

    return {
      'noteOn': noteOn,
      'noteOff': noteOff,
      'setProgram': setProgram
    }
  }

  var channels = []
  for (var i = 0; i < channelCount; i++) {
    channels[i] = Channel()
  }

  var nextEventInfo
  var samplesToNextEvent = 0

  function getNextEvent () {
    var ticksToNextEvent = null
    var nextEventTrack = null
    var nextEventIndex = null

    for (var i = 0; i < trackStates.length; i++) {
      if (
        trackStates[i].ticksToNextEvent != null
        && (ticksToNextEvent == null || trackStates[i].ticksToNextEvent < ticksToNextEvent)
      ) {
        ticksToNextEvent = trackStates[i].ticksToNextEvent
        nextEventTrack = i
        nextEventIndex = trackStates[i].nextEventIndex
      }
    }
    if (nextEventTrack != null) {
      /* consume event from that track */
      var nextEvent = midiFile.tracks[nextEventTrack][nextEventIndex]
      if (midiFile.tracks[nextEventTrack][nextEventIndex + 1]) {
        trackStates[nextEventTrack].ticksToNextEvent += midiFile.tracks[nextEventTrack][nextEventIndex + 1].deltaTime
      } else {
        trackStates[nextEventTrack].ticksToNextEvent = null
      }
      trackStates[nextEventTrack].nextEventIndex += 1
      /* advance timings on all tracks by ticksToNextEvent */
      for (var i = 0; i < trackStates.length; i++) {
        if (trackStates[i].ticksToNextEvent != null) {
          trackStates[i].ticksToNextEvent -= ticksToNextEvent
        }
      }
      nextEventInfo = {
        'ticksToEvent': ticksToNextEvent,
        'event': nextEvent,
        'track': nextEventTrack
      }
      var beatsToNextEvent = ticksToNextEvent / ticksPerBeat
      var secondsToNextEvent = beatsToNextEvent / (beatsPerMinute / 60)
      samplesToNextEvent += secondsToNextEvent * synth.sampleRate
    } else {
      nextEventInfo = null
      samplesToNextEvent = null
      self.finished = true
    }
  }

  getNextEvent()

  function generate (samples) {
    var data = new Array(samples * 2)
    var samplesRemaining = samples
    var dataOffset = 0

    while (true) {
      if (samplesToNextEvent != null && samplesToNextEvent <= samplesRemaining) {
        /* generate samplesToNextEvent samples, process event and repeat */
        var samplesToGenerate = Math.ceil(samplesToNextEvent)
        if (samplesToGenerate > 0) {
          synth.generateIntoBuffer(samplesToGenerate, data, dataOffset)
          dataOffset += samplesToGenerate * 2
          samplesRemaining -= samplesToGenerate
          samplesToNextEvent -= samplesToGenerate
        }

        handleEvent()
        getNextEvent()
      } else {
        /* generate samples to end of buffer */
        if (samplesRemaining > 0) {
          synth.generateIntoBuffer(samplesRemaining, data, dataOffset)
          samplesToNextEvent -= samplesRemaining
        }
        break
      }
    }
    return data
  }

  function handleEvent () {
    var event = nextEventInfo.event
    switch (event.type) {
      case 'meta':
        switch (event.subtype) {
          case 'setTempo':
            beatsPerMinute = 60000000 / event.microsecondsPerBeat
        }
        break
      case 'channel':
        switch (event.subtype) {
          case 'noteOn':
            channels[event.channel].noteOn(event.noteNumber, event.velocity)
            break
          case 'noteOff':
            channels[event.channel].noteOff(event.noteNumber, event.velocity)
            break
          case 'programChange':
            // console.log('program change to ' + event.programNumber)
            channels[event.channel].setProgram(event.programNumber)
            break
        }
        break
    }
  }

  function replay (audio) {
    console.log('replay')
    audio.write(generate(44100))
    setTimeout(function () {replay(audio)}, 10)
  }

  var self = {
    'replay': replay,
    'generate': generate,
    'finished': false
  }
  return self
}

},{}],5:[function(require,module,exports){
/* Stream */
module.exports = function (str) {
  var position = 0

  function read (length) {
    var result = str.substr(position, length)
    position += length
    return result
  }

  /* read a big-endian 32-bit integer */
  function readInt32 () {
    var result = (
    (str.charCodeAt(position) << 24)
      + (str.charCodeAt(position + 1) << 16)
      + (str.charCodeAt(position + 2) << 8)
      + str.charCodeAt(position + 3))
    position += 4
    return result
  }

  /* read a big-endian 16-bit integer */
  function readInt16 () {
    var result = (
    (str.charCodeAt(position) << 8)
      + str.charCodeAt(position + 1))
    position += 2
    return result
  }

  /* read an 8-bit integer */
  function readInt8 (signed) {
    var result = str.charCodeAt(position)
    if (signed && result > 127) result -= 256
    position += 1
    return result
  }

  function eof () {
    return position >= str.length
  }

  /* read a MIDI-style variable-length integer
  	(big-endian value in groups of 7 bits,
  	with top bit set to signify that another byte follows)
  */
  function readVarInt () {
    var result = 0
    while (true) {
      var b = readInt8()
      if (b & 0x80) {
        result += (b & 0x7f)
        result <<= 7
      } else {
        /* b is the last byte */
        return result + b
      }
    }
  }

  return {
    'eof': eof,
    'read': read,
    'readInt32': readInt32,
    'readInt16': readInt16,
    'readInt8': readInt8,
    'readVarInt': readVarInt
  }
}

},{}],6:[function(require,module,exports){
var Audio = require('./audio')

function SineGenerator (freq) {
  var self = {'alive': true}
  var period = Audio.sampleRate / freq
  var t = 0

  self.generate = function (buf, offset, count) {
    for (; count; count--) {
      var phase = t / period
      var result = Math.sin(phase * 2 * Math.PI)
      buf[offset++] += result
      buf[offset++] += result
      t++
    }
  }

  return self
}
module.exports.SineGenerator = SineGenerator

function SquareGenerator (freq, phase) {
  var self = {'alive': true}
  var period = Audio.sampleRate / freq
  var t = 0

  self.generate = function (buf, offset, count) {
    for (; count; count--) {
      var result = ((t / period) % 1 > phase ? 1 : -1)
      buf[offset++] += result
      buf[offset++] += result
      t++
    }
  }

  return self
}
module.exports.SquareGenerator = SquareGenerator

function ADSRGenerator (child, attackAmplitude, sustainAmplitude, attackTimeS, decayTimeS, releaseTimeS) {
  var self = {'alive': true}
  var attackTime = Audio.sampleRate * attackTimeS
  var decayTime = Audio.sampleRate * (attackTimeS + decayTimeS)
  var decayRate = (attackAmplitude - sustainAmplitude) / (decayTime - attackTime)
  var releaseTime = null /* not known yet */
  var endTime = null /* not known yet */
  var releaseRate = sustainAmplitude / (Audio.sampleRate * releaseTimeS)
  var t = 0

  self.noteOff = function () {
    if (self.released) return
    releaseTime = t
    self.released = true
    endTime = releaseTime + Audio.sampleRate * releaseTimeS
  }

  self.generate = function (buf, offset, count) {
    if (!self.alive) return
    var input = new Array(count * 2)
    for (var i = 0; i < count * 2; i++) {
      input[i] = 0
    }
    child.generate(input, 0, count)

    childOffset = 0
    while(count) {
      if (releaseTime != null) {
        if (t < endTime) {
          /* release */
          while(count && t < endTime) {
            var ampl = sustainAmplitude - releaseRate * (t - releaseTime)
            buf[offset++] += input[childOffset++] * ampl
            buf[offset++] += input[childOffset++] * ampl
            t++
            count--
          }
        } else {
          /* dead */
          self.alive = false
          return
        }
      } else if (t < attackTime) {
        /* attack */
        while(count && t < attackTime) {
          var ampl = attackAmplitude * t / attackTime
          buf[offset++] += input[childOffset++] * ampl
          buf[offset++] += input[childOffset++] * ampl
          t++
          count--
        }
      } else if (t < decayTime) {
        /* decay */
        while(count && t < decayTime) {
          var ampl = attackAmplitude - decayRate * (t - attackTime)
          buf[offset++] += input[childOffset++] * ampl
          buf[offset++] += input[childOffset++] * ampl
          t++
          count--
        }
      } else {
        /* sustain */
        while(count) {
          buf[offset++] += input[childOffset++] * sustainAmplitude
          buf[offset++] += input[childOffset++] * sustainAmplitude
          t++
          count--
        }
      }
    }
  }

  return self
}
module.exports.ADSRGenerator = ADSRGenerator

midiToFrequency = function (note) {
  return 440 * Math.pow(2, (note - 69) / 12)
}
module.exports.midiToFrequency = midiToFrequency

PianoProgram = {
  'attackAmplitude': 0.2,
  'sustainAmplitude': 0.1,
  'attackTime': 0.02,
  'decayTime': 0.3,
  'releaseTime': 0.02,
  'createNote': function (note, velocity) {
    var frequency = midiToFrequency(note)
    return ADSRGenerator(
      SineGenerator(frequency),
      this.attackAmplitude * (velocity / 128), this.sustainAmplitude * (velocity / 128),
      this.attackTime, this.decayTime, this.releaseTime
    )
  }
}
module.exports.PianoProgram = PianoProgram

StringProgram = {
  'createNote': function (note, velocity) {
    var frequency = midiToFrequency(note)
    return ADSRGenerator(
      SineGenerator(frequency),
      0.5 * (velocity / 128), 0.2 * (velocity / 128),
      0.4, 0.8, 0.4
    )
  }
}
module.exports.StringProgram = StringProgram

PROGRAMS = {
  41: StringProgram,
  42: StringProgram,
  43: StringProgram,
  44: StringProgram,
  45: StringProgram,
  46: StringProgram,
  47: StringProgram,
  49: StringProgram,
  50: StringProgram
}
module.exports.PROGRAMS = PROGRAMS

module.exports.Synth = function Synth (sampleRate) {
  var generators = []

  function addGenerator (generator) {
    generators.push(generator)
  }

  function generate (samples) {
    var data = new Array(samples * 2)
    generateIntoBuffer(samples, data, 0)
    return data
  }

  function generateIntoBuffer (samplesToGenerate, buffer, offset) {
    for (var i = offset; i < offset + samplesToGenerate * 2; i++) {
      buffer[i] = 0
    }
    for (var i = generators.length - 1; i >= 0; i--) {
      generators[i].generate(buffer, offset, samplesToGenerate)
      if (!generators[i].alive) generators.splice(i, 1)
    }
  }

  return {
    'sampleRate': Audio.sampleRate,
    'addGenerator': addGenerator,
    'generate': generate,
    'generateIntoBuffer': generateIntoBuffer
  }
}

},{"./audio":1}]},{},[2])(2)
});