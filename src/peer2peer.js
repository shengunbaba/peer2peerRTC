import {EventDispatcher, createShortId} from './utils'

export default class Peer2peer extends EventDispatcher {
    constructor(opts) {
        super(opts)
        this.rtcConfiguration = opts.rtcConfiguration || null;
        this.initiator = opts.initiator || false
        this.offerOptions = opts.offerOptions || {offerToReceiveAudio: true, offerToReceiveVideo: true};
        this.answerOptions = opts.answerOptions || {}
        this.constraints = opts.constraints || {audio: true, video: true};
        this.localStream = new MediaStream()
        this.remoteStream = new MediaStream()

        this._pc = new RTCPeerConnection(this.rtcConfiguration);
        this.id = createShortId()
        this._senders = new Map()

        this._pc.oniceconnectionstatechange = (e) => {
            console.log(e, this._pc.iceConnectionState)
        }
        this._pc.onicegatheringstatechange = (e) => {
            console.log(e, this._pc.iceConnectionState)
        }
        this._pc.onconnectionstatechange = (e) => {
            console.log(e, this._pc.connectionState)
        }
        this._pc.onsignalingstatechange = (e) => console.log(e, this._pc.signalingState)

        this._pc.onicecandidate = event => this._onicecandidate(event)

        this._pc.ontrack = e => this._onTrack(e)

        this._initStreamPromise = this._initStream(opts);
    }

    _initStream(opts) {
        return new Promise((resolve) => {
            if (opts.localStream && typeof opts.localStream instanceof MediaStream) {
                this._addTrack(opts.localStream)
                resolve()
            } else {
                this._createLocalStream(this.constraints).then(stream => {
                    this._addTrack(stream)
                    resolve()
                })
            }
        })

    }

    _addTrack(stream) {
        for (const track of stream.getTracks()) {
            this.localStream.addTrack(track);
            const sender = this._pc.addTrack(track, stream)
            this._senders.set(sender.track.kind, sender)
        }
        this.dispatchEvent({type: 'localStream', stream: this.localStream})
    }

    _removeTrack(kind) {
        if (kind === 'video') {
            const videoTrack = this.localStream.getVideoTracks()[0];
            this.localStream.removeTrack(videoTrack);
            videoTrack.stop();
            const sender = this._senders.get('video');
            this._pc.removeTrack(sender);
            this._senders.delete('video');
            return sender.replaceTrack(null);
        }

    }

    _createLocalStream(constraints) {
        return navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            return stream;
        }, error => {
            this.dispatchEvent({type: 'error', error})
        })
    }

    _onTrack(event) {
        const _remoteStream = event.streams[0];
        if (!_remoteStream) return

        const video = this.remoteStream.getVideoTracks()[0];
        if (video) {
            this.remoteStream.removeTrack(video)
        }
        for (const track of _remoteStream.getTracks()) {
            this.remoteStream.addTrack(track)
        }
        this.dispatchEvent({type: 'remoteStream', stream: this.remoteStream})
    }

    _onicecandidate(event) {
        this.dispatchEvent(event)
    }

    _createOffer(iceRestart) {
        return this._pc.createOffer({...this.offerOptions, iceRestart}).then(offer => {
            return this._pc.setLocalDescription(offer).then(() => {
                this.dispatchEvent(offer)
            }).catch(error => {
                this.dispatchEvent({type: 'error', error})
            })
        })
    }

    _createAnswer() {
        this._pc.createAnswer(this.answerOptions).then(answer => {
            this._pc.setLocalDescription(answer).then(() => {
                this.dispatchEvent(answer)
            }).catch(error => this.dispatchEvent({type: 'error', error}))
        }).catch(error => this.dispatchEvent({type: 'error', error}))
    }

    signal(data) {
        if (data === 'ready') {
            if (this.initiator) {
                this._initStreamPromise.then(() => this._createOffer());
            }
            return
        }
        if (data.sdp) {
            this._pc.setRemoteDescription(data).then(() => {
                if (data.type === 'offer') this._createAnswer()
            }).catch(error => {
                this.dispatchEvent({type: 'error', error})
            })
        }

        if (data.candidate) {
            this._pc.addIceCandidate(data.candidate)
        }
    }

    mute(kind) {
        if (typeof kind !== 'string') {
            return Promise.reject('track kind need string!')
        }
        if (!/^(audio)|(video)$/.test(kind)) {
            return Promise.reject('track kind need audio or video!')
        }
        if (kind === 'audio') {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (!audioTrack) {
                return Promise.reject('local stream does not has audio track!');
            }
            audioTrack.enabled = false;
            return Promise.resolve()
        }

        if (kind === 'video') {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (!videoTrack) {
                return Promise.reject('local stream does not has video track!');
            }
            return this._removeTrack('video')
                .then(() => this._createOffer(true))
        }
    }

    unmute(kind) {
        if (typeof kind !== 'string') {
            return Promise.reject('track kind need string!')
        }
        if (!/^(audio)|(video)$/.test(kind)) {
            return Promise.reject('track kind need audio or video!')
        }
        if (kind === 'audio') {
            const audioTrack = this.localStream.getAudioTracks()[0];
            audioTrack.enabled = true;
            return Promise.resolve()
        }

        if (kind === 'video') {
            const video = this.constraints.video;
            return this._createLocalStream({audio: false, video}).then(stream => {
                return this._addTrack(stream)
            }).then(() => this._createOffer(true))
        }
    }

    leave() {
        for (const track of this.localStream.getTracks()) {
            track.stop()
        }
        this.localStream = new MediaStream()
        this._pc.close()
    }
}


window.Peer2peer = Peer2peer
