/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2024 Alexey Portnov and Nikolay Beketov
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 */

class SipClient {
    constructor() {
        this.connSettings = {
            pbxHost: '',
            currentPhone: '',
            sipPassword: '',
        };
        this.mediaExist = false;
        this.config = {};
        this.sessionEventHandlers = {};
        this.phone = null;
        this.ringtone = null;
        this.ringbacktone = null;
        this.dtmfTone = null;
        this.sipRemoteAudio = null;
        this.Sessions = [];
        this.callTimers = {};
        this.callActiveID = null;
        this.callVolume = 1;
        this.Stream = null;
        this.widget = null;

        this.addAudioTag('ringtone', 'outgoing');
        this.addAudioTag('ringbacktone', 'incoming');
        this.addAudioTag('dtmfTone', 'dtmf');
        this.sipRemoteAudio = document.createElement("audio");
    }

    addAudioTag(key, path) {
        this[key] = new Audio(`sounds/${path}.mp3`);
        if (path !== "dtmf") {
            this[key].loop = true;
        }
        this[key].addEventListener('ended', () => {
            this[key].currentTime = 0;
            if (path !== "dtmf") {
                this[key].play();
            }
        });
    }

    start(widget) {
        this.widget = widget;
        Object.assign(this.connSettings, widget.settings);

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        if (!this.connSettings.pbxHost.trim()) return;

        const socket = new JsSIP.WebSocketInterface(`${protocol}://${this.connSettings.pbxHost}/webrtc`);
        this.config = {
            sockets: [socket],
            uri: new JsSIP.URI('sip', `${this.connSettings.currentPhone}-WS`, this.connSettings.pbxHost).toAor(),
            password: this.connSettings.sipPassword,
            authorization_user: this.connSettings.currentPhone,
            display_name: this.connSettings.currentPhone,
            user_agent: 'El Soft Phone WebRTC',
            register_expires: 30
        };
        const self = this;
        this.sessionEventHandlers = {
            'peerconnection': function (){ self.sessionOnPeerConnection(this); },
            'progress': function (){ self.sessionOnProgress(this);},
            'connecting': function (){ self.sessionOnConnecting(this);},
            'accepted': function (){ self.sessionOnAccepted(this);},
            'hold': function (){ self.sessionOnHold(this); },
            'unhold': function (){ self.sessionOnUnHold(this); },
            'cancel': function (){ self.sessionOnCancel(this); },
            'failed': function (){ self.sessionOnFailed(this); },
            'ended': function (){ self.sessionOnEnded(this); },
            'confirmed': function (){ self.sessionOnConfirmed(this); }
        };

        this.phone = new JsSIP.UA(this.config);
        this.setStatus("Connecting");
        this.phone.start();

        this.phone.on('connected', () => this.setStatus("Connected"));
        this.phone.on('disconnected', () => {
            this.setStatus("Disconnected");
            this.setError(true, 'Websocket Disconnected.', 'An Error occurred connecting to the websocket.');
        });
        this.phone.on('registrationFailed', () => {
            this.setError(true, 'Registration Error.', 'An Error occurred registering your phone. Check your settings.');
            this.setStatus("RegistrationFailed");
        });
        this.phone.on('unregistered', () => {
            this.setError(true, 'Registration Error.', 'An Error occurred registering your phone. Check your settings.');
            this.setStatus("Disconnected");
        });
        this.phone.on('newRTCSession', (e) => {
            Object.keys(this.sessionEventHandlers).forEach(key => e.session.on(key, this.sessionEventHandlers[key]));
            if (e.originator !== 'remote') return;
            this.newSession(e.session);
        });
        this.phone.on('sipEvent', (data, parameter) => {
            console.debug(data, parameter);
        });
        this.phone.on('registered', () => {
            window.onbeforeunload = () => 'If you close this window, you will not be able to make or receive calls from your browser.';
            window.onunload = () => {
                localStorage.removeItem('ctxPhone');
                this.phone.stop();
            };
            localStorage.setItem('ctxPhone', 'true');
            this.setStatus("Ready");
        });
    }

    formatPhone(phone) {
        let num = phone.includes('@') ? JsSIP.URI.parse(phone).user : phone;
        return num.toString().replace(/\D/g, '');
    }

    makeAor(target) {
        return new JsSIP.URI('sip', target, this.connSettings.pbxHost).toAor();
    }

    setCallSessionStatus(status) {
        /** **/
    }

    setStatus(status) {
        this.widget.status = status;
        console.debug(status);
    }

    setError(err, title, msg, closable) {
        console.error(err, title, msg, closable);
    }

    answer(sessionid) {
        const call = this.widget.calls.find(o => o.id === sessionid);
        if (!call) return;

        const options = {
            eventHandlers: this.sessionEventHandlers,
            mediaConstraints: { audio: true, video: false },
            mediaStream: this.sipRemoteAudio.srcObject || this.sipRemoteAudio.src,
        };
        call.session.answer(options);
    }

    dial(target) {
        const options = {
            mediaConstraints: { audio: true, video: false },
            mediaStream: this.sipRemoteAudio.srcObject || this.sipRemoteAudio.src,
        };
        const aor = this.makeAor(target);
        let s = this.phone.call(aor, options);
        s.connection.onaddstream = this.connectionOnAddStream.bind(this);
        this.newSession(s);
    }

    connectionOnAddStream(e) {
        if ('srcObject' in this.sipRemoteAudio) {
            this.sipRemoteAudio.srcObject = e.stream;
        } else {
            this.sipRemoteAudio.src = window.URL.createObjectURL(e.stream);
        }
        this.sipRemoteAudio.play();
    }

    newSession(newSess) {
        newSess.displayName = newSess.remote_identity.display_name || newSess.remote_identity.uri.user;
        newSess.ctxid       = newSess.id;
        let status;
        if (newSess.direction === 'incoming') {
            status = "Incoming: "+ newSess.displayName;
            this.ringbacktone.play();
        } else {
            status = "Trying: "+ newSess.displayName;
            this.ringtone.play();
        }
        this.Sessions[newSess.ctxid] = newSess;
        this.updateActiveLine(newSess, 'ringing');
        this.setCallSessionStatus(status);
    }

    handleSessionProgress(session) {
        this.setCallSessionStatus("Ringing");
        this.ringtone.play();
        session.direction = 'outgoing';
    }

    handleSessionAccepted(session) {
        this.setCallSessionStatus("In Progress");
        this.ringtone.pause();
        this.ringtone.currentTime = 0;
        this.setCallSessionStatus("Active");

        let self = this;
        session.on('hold',   () => { self.sessionOnHold(this);   });
        session.on('unhold', () => { self.sessionOnUnHold(this); });
    }

    handleSessionEnded(session) {
        this.setCallSessionStatus("Ended");
        session.mState = 'ended';
    }

    handleSessionFailed(session) {
        this.setCallSessionStatus("Failed");
        session.mState = 'failed';
    }

    handleSessionConfirmed(session) {
        session.mState = 'confirmed';
        this.setCallSessionStatus("Confirmed");
        this.ringtone.pause();
        this.ringtone.currentTime = 0;
    }

    sessionOnPeerConnection(session) {
        if (session.direction !== 'incoming') {
            return;
        }
        session.connection.onaddstream = this.connectionOnAddStream.bind(this);
    }

    sessionOnProgress(session) {
        if (session.direction === 'outgoing') {
            this.setCallSessionStatus('Calling...');
        }
    }
    sessionOnConnecting(session) {
        if (session.direction === 'outgoing') {
            this.setCallSessionStatus('Connecting...');
        }
    }
    sessionOnAccepted(session) {
        let call = this.getSessionById(session.ctxid);
        if (call !== undefined) {
            call.isAnswered = true;
        }
        if (this.callActiveID && this.callActiveID !== session.ctxid) {
            if (session.isOnHold().local === true) {
                session.unhold();
            } else {
                session.hold();
            }
        }
        this.ringtone.pause();
        this.ringbacktone.pause();
        this.setCallSessionStatus('Answered');
        this.updateActiveLine(session, 'answered');
        this.callActiveID = session.ctxid;
    }
    sessionOnHold(session) {
        let call = this.getSessionById(session.ctxid);
        if (call !== undefined) {
            call.isHold = true;
        }
        console.log('hold');
        this.updateActiveLine(session, 'holding');
        this.callActiveID = session.ctxid;
    }
    sessionOnUnHold(session) {
        let call = this.getSessionById(session.ctxid);
        if (call !== undefined) {
            call.isHold = false;
        }
        console.log('unhold');
        this.updateActiveLine(session, 'resumed');
        this.callActiveID = session.ctxid;
    }
    sessionOnCancel(session) {
        console.log('cancel');
        this.ringtone.pause();
        this.ringbacktone.pause();
        this.setCallSessionStatus("Canceled");
        if (session.direction === 'outgoing') {
            this.callActiveID = null;
            this.updateActiveLine(session, 'ended');
        }
        this.deleteActiveLine(session.ctxid);
    }
    sessionOnFailed(session) {
        console.log('failed');
        this.ringtone.pause();
        this.ringbacktone.pause();
        this.setCallSessionStatus('Terminated');
        this.updateActiveLine(session, 'ended');
        this.callActiveID = null;
        this.deleteActiveLine(session.ctxid);
    }
    sessionOnEnded(session) {
        console.log('ended');
        this.ringtone.pause();
        this.ringbacktone.pause();
        this.setCallSessionStatus("");
        this.updateActiveLine(session, 'ended');
        this.callActiveID = null;
        this.deleteActiveLine(session.ctxid);
    }
    sessionOnConfirmed(session) {
        console.log(session.ctxid, 'call confirmed');
    }
    getSessionById(id) {
        return this.widget.calls.find(call => call.id === id);
    }
    /**
     * Update state line
     *
     * @param  {object} session
     * @param  {string} status Enum 'ringing', 'answered', 'ended', 'holding', 'resumed'
     */
    updateActiveLine(session, status) {
        let call = this.getSessionById(session.id);
        if (call === undefined) {
            let length = this.widget.calls.push({
                display_name : session.remote_identity.display_name,
                id           : session.ctxid,
                user         : session.remote_identity.uri.user,
                start        : new Date().getTime(),
                status       : status,
                stop         : 0,
                session      : session,
                duration     : 0,
                isIncoming   : session.direction === 'incoming',
                isAnswered   : false,
                isHold       : false,
            });
            call = this.widget.calls[length - 1];
        }else{
            call.status = status;
        }
        if (status === 'ended') {
            call.stop = new Date().getTime();
        }
        if (status === 'ended' && call.status === 'ringing') {
            call.status = 'missed';
        } else {
            call.status = status;
        }
    }
    deleteActiveLine(id){
        let call = this.widget.calls.find(o => o.id === id);
        this.widget.calls.splice(this.widget.calls.indexOf(call), 1);
    }

    playDtmfTone(sessionId, digit) {
        let call = this.widget.calls.find(o => o.id === sessionId);
        if (call === undefined) {
            return;
        }
        try { this.dtmfTone.play(); } catch(e) { }
        let s = call.session;
        s.sendDTMF(digit);
    }

    sipHangUp(sessionid) {
        let s = this.Sessions[sessionid];
        if (!s || s.isEnded()) {
            return;
        }
        s.terminate();
    }
}