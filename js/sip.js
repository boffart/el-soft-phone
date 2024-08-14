/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2022 Alexey Portnov and Nikolay Beketov
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

function translate(data){
	console.log(data);
	return data;
}

const ctxSip = {
    connSettings: {
        pbxHost: '',
        currentPhone: '',
        sipPassword: '',
    },
    mediaExist: false,
    config : {},
    sessionEventHandlers: {},
    phone 		 : null,
    ringtone     : null,
    ringbacktone : null,
    dtmfTone     : null,
    sipRemoteAudio: null,
    Sessions     : [],
    callTimers   : {},
    callActiveID : null,
    callVolume   : 1,
    Stream       : null,
    widget  	 : null,

    addAudioTag: function (key, path){
        ctxSip[key] = new Audio(`sounds/${path}.mp3`);
        if(path !== "dtmf"){
            ctxSip[key].loop = true;
        }
        ctxSip[key].addEventListener('ended', function() {
            this.currentTime = 0;
            if(path !== "dtmf"){
                this.play();
            }
        }, false);
    },
    start: function (widget){
        ctxSip.widget = widget;

        ctxSip.addAudioTag('ringtone', 		'outgoing');
        ctxSip.addAudioTag('ringbacktone',     'incoming');
        ctxSip.addAudioTag('dtmfTone', 		'dtmf');
        ctxSip.sipRemoteAudio = document.createElement("audio");

        $.each(ctxSip.widget.settings, function (key, value){
            if(typeof ctxSip.connSettings[key] === 'undefined'){
                return;
            }
            ctxSip.connSettings[key] = value;
        });
        let protocol = 'ws';
        if(window.location.protocol === 'https:'){
            protocol = 'wss';
        }
        if(ctxSip.connSettings.pbxHost.trim() === ''){
            return;
        }

        let socket = new JsSIP.WebSocketInterface(protocol+'://'+ctxSip.connSettings.pbxHost+'/webrtc');
        ctxSip.config = {
            sockets  			: [ socket ],
            uri      			: new JsSIP.URI('sip', ctxSip.connSettings.currentPhone+'-WS', ctxSip.connSettings.pbxHost).toAor(),
            password 			: ctxSip.connSettings.sipPassword,
            authorization_user	: ctxSip.connSettings.currentPhone,
            display_name 		: ctxSip.connSettings.currentPhone,
            user_agent			: 'El Soft Phone WebRTC',
            register_expires	: 30,
            // session_timers: false,
            // session_timers_refresh_method: 'invite'
        };

        ctxSip.sessionEventHandlers = {
            'peerconnection': ctxSip.sessionOnPeerConnection,
            'progress'      : ctxSip.sessionOnProgress,
            'connecting'    : ctxSip.sessionOnConnecting,
            'accepted'      : ctxSip.sessionOnAccepted,
            'hold'          : ctxSip.sessionOnHold,
            'unhold'        : ctxSip.sessionOnUnHold,
            'cancel'        : ctxSip.sessionOnCancel,
            'muted'         : ctxSip.sessionOnMuted,
            'unmuted'       : ctxSip.sessionOnUnMuted,
            'failed'        : ctxSip.sessionOnFailed,
            'ended'         : ctxSip.sessionOnEnded,
            'confirmed'     : ctxSip.sessionOnConfirmed
        };

        ctxSip.phone  = new JsSIP.UA(ctxSip.config);
        ctxSip.setStatus("Connecting");
        ctxSip.phone.start();

        ctxSip.phone.on('connected', function() {
            ctxSip.setStatus("Connected");
        });
        ctxSip.phone.on('disconnected', function() {
            ctxSip.setStatus("Disconnected");
            ctxSip.setError(true, 'Websocket Disconnected.', 'An Error occurred connecting to the websocket.');
            // remove existing sessions
            $("#sessions > .session").each(function(i, session) {
                ctxSip.removeSession(session, 500);
            });
        });
        ctxSip.phone.on('registrationFailed', function() {
            ctxSip.setError(true, 'Registration Error.', 'An Error occurred registering your phone. Check your settings.');
            ctxSip.setStatus("RegistrationFailed");
        });
        ctxSip.phone.on('unregistered', function() {
            ctxSip.setError(true, 'Registration Error.', 'An Error occurred registering your phone. Check your settings.');
            ctxSip.setStatus("Disconnected");
        });
        ctxSip.phone.on('newRTCSession', function(e){
            for (let key in ctxSip.sessionEventHandlers) {
                e.session.on(key, ctxSip.sessionEventHandlers[key]);
            }
            if(e.originator !== 'remote'){
                return;
            }
            e.session.direction = 'incoming';
            ctxSip.newSession(e.session);
        });
        ctxSip.phone.on('sipEvent', function(data, parameter) {
            // console.log(parameter, data);
        });
        ctxSip.phone.on('registered', function() {
            window.onbeforeunload = () => {
                return 'If you close this window, you will not be able to make or receive calls from your browser.';
            };
            window.onunload       = () => {
                localStorage.removeItem('ctxPhone');
                ctxSip.phone.stop();
            };
            // This key is set to prevent multiple windows.
            localStorage.setItem('ctxPhone', 'true');
            ctxSip.setStatus("Ready");
        });

    },

    /**
     * Parses a SIP uri and returns a formatted US phone number.
     *
     * @param  {string} phone number or uri to format
     * @return {string}       formatted number
     */
    formatPhone : function(phone) {
        let num;
        if (phone.indexOf('@')) {
            return JsSIP.URI.parse(phone).user;
        } else {
            num = phone;
        }
        num = num.toString().replace(/[^0-9]/g, '');
        if (num.length === 10) {
            return '(' + num.substr(0, 3) + ') ' + num.substr(3, 3) + '-' + num.substr(6,4);
        } else if (num.length === 11) {
            return '(' + num.substr(1, 3) + ') ' + num.substr(4, 3) + '-' + num.substr(7,4);
        } else {
            return num;
        }
    },

    /**
     * Получение AOR для набираемого номера телефора.
     * @param target
     * @returns {*}
     */
    makeAor : function (target){
        return (new JsSIP.URI('sip', target, ctxSip.connSettings.pbxHost).toAor());
    },

    /**
     * sets the ui call status field
     *
     * @param {string} status
     */
    setCallSessionStatus : function(status) {
        // TODO
        $('#txtCallStatus').html(status);
    },

    /**
     * sets the ui connection status field
     *
     * @param {string} status
     */
    setStatus : function(status) {
	    ctxSip.widget.status = translate(status);
	    
        console.debug(status);
        let icon    = 'fa-question',
            tooltip = '???',
            text    = '';
        if(status === 'Ready' || 'Connected' === status){
            icon    = 'fa-signal';
            tooltip = translate('statusPhone.'+status);
            text    = tooltip;
        }else if(status === 'Connecting'){
            icon = 'fa-circle text-primary';
            tooltip = translate('statusPhone.'+status);
        }else if(status === 'RegistrationFailed'){
            icon = 'fa-circle text-danger';
            tooltip = translate('statusPhone.'+status);
        }else if(status === 'Disconnected'){
            icon = 'fa-circle text-dark';
            tooltip = translate('statusPhone.'+status);
            text = tooltip;
        }
        // TODO
        $("#txtRegStatus").html('<i class="fa '+icon+' me-1" role="button" data-bs-toggle="tooltip" data-bs-placement="right" title="'+tooltip+'"></i> ' + text);
        let tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl)
        })
    },

    /**
     *  Вывод информации об ошибке.
     * @param err
     * @param title
     * @param msg
     * @param closable
     */
    setError : function(err, title, msg, closable) {
        console.log(err, title, msg, closable);
    },

    answer : function(sessionid) {
        let call = ctxSip.widget.calls.find(o => o.id === sessionid);
        if (call === undefined) {
            return;
        }
        let srcField = '';
        if ('srcObject' in ctxSip.sipRemoteAudio) {
            srcField = 'srcObject';
        } else {
            srcField = 'src';
        }
        let options = {
            eventHandlers    : ctxSip.sessionEventHandlers,
            mediaConstraints : { audio : true, video : false },
            mediaStream      : ctxSip.sipRemoteAudio[srcField],
        };
        call.session.answer(options);
    },

    dial : function(target){
        let srcField = '';
        if ('srcObject' in ctxSip.sipRemoteAudio) {
            srcField = 'srcObject';
        } else {
            srcField = 'src';
        }
        let options = {
            'mediaConstraints' : {'audio': true, 'video': false},
            // 'iceServers':  [{urls: ['stun:stun.sipnet.ru:3478']}],
            'mediaStream': ctxSip.sipRemoteAudio[srcField],
        };
        let aor = ctxSip.makeAor(target);
        let s = ctxSip.phone.call(aor, options);
        s.connection.onaddstream = ctxSip.connectionOnAddStream;
        s.direction = 'outgoing';
        ctxSip.newSession(s);
    },

    /**
     * Обработка события добавления нового медиа потока.
     * @param e
     */
    connectionOnAddStream: function(e){
        // https://github.com/versatica/JsSIP/issues/501
        // ctxSip.sipRemoteAudio.srcObject = e.stream;
        // ctxSip.sipRemoteAudio.play();
        // ctxSip.sipRemoteAudio = document.createElement('audio');
        if ('srcObject' in ctxSip.sipRemoteAudio) {
            ctxSip.sipRemoteAudio.srcObject = e.stream;
        } else {
            ctxSip.sipRemoteAudio.src = window.URL.createObjectURL(e.stream);
        }
        ctxSip.sipRemoteAudio.play();
    },

    startRingTone : function() {
        try { ctxSip.ringtone.play(); } catch (e) { }
    },

    stopRingTone : function() {
        try { ctxSip.ringtone.pause(); } catch (e) { }
    },

    startRingbackTone : function() {
        try { ctxSip.ringbacktone.play(); } catch (e) { }
    },

    stopRingbackTone : function() {
        try { ctxSip.ringbacktone.pause(); } catch (e) { }
    },

    getUniqueID : function() {
        return Math.random().toString(36).substr(2, 9);
    },

    /**
     * Update state line
     *
     * @param  {object} session
     * @param  {string} status Enum 'ringing', 'answered', 'ended', 'holding', 'resumed'
     */
    updateActiveLine : function(session, status) {
        let call = ctxSip.widget.calls.find(o => o.id === session.ctxid);
        if (call === undefined) {
            let length = ctxSip.widget.calls.push({
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
            call = ctxSip.widget.calls[length - 1];
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
    },

    deleteActiveLine: function (id){
        let call = ctxSip.widget.calls.find(o => o.id === id);
        ctxSip.widget.calls.splice(ctxSip.widget.calls.indexOf(call), 1);
    },

    sessionOnPeerConnection: function () {
        if (this.direction !== 'incoming') {
            return;
        }
        this.connection.onaddstream = ctxSip.connectionOnAddStream;
    },

    sessionOnConnecting: function() {
        if (this.direction === 'outgoing') {
            ctxSip.setCallSessionStatus('Connecting...');
        }
    },
    sessionOnProgress: function() {
        if (this.direction === 'outgoing') {
            ctxSip.setCallSessionStatus('Calling...');
        }
    },
    sessionOnAccepted: function() {
        let call = ctxSip.widget.calls.find(o => o.id === this.ctxid);
        if (call !== undefined) {
            call.isAnswered = true;
        }
        if (ctxSip.callActiveID && ctxSip.callActiveID !== this.ctxid) {
            ctxSip.phoneHoldButtonPressed(ctxSip.callActiveID);
        }
        ctxSip.stopRingbackTone();
        ctxSip.stopRingTone();
        ctxSip.setCallSessionStatus('Answered');
        ctxSip.updateActiveLine(this, 'answered');
        ctxSip.callActiveID = this.ctxid;
    },
    sessionOnHold: function() {
        let call = ctxSip.widget.calls.find(o => o.id === this.ctxid);
        if (call !== undefined) {
            call.isHold = true;
        }
        console.log('hold');
        ctxSip.updateActiveLine(this, 'resumed');
        ctxSip.callActiveID = this.ctxid;
    },
    sessionOnUnHold: function() {
        let call = ctxSip.widget.calls.find(o => o.id === this.ctxid);
        if (call !== undefined) {
            call.isHold = false;
        }

        console.log('unhold');
        ctxSip.updateActiveLine(this, 'resumed');
        ctxSip.callActiveID = this.ctxid;
    },
    sessionOnCancel: function() {
        console.log('cancel');
        ctxSip.stopRingTone();
        ctxSip.stopRingbackTone();
        ctxSip.setCallSessionStatus("Canceled");
        if (this.direction === 'outgoing') {
            ctxSip.callActiveID = null;
            ctxSip.updateActiveLine(this, 'ended');
        }
        ctxSip.deleteActiveLine(this.ctxid);
    },

    sessionOnFailed: function() {
        console.log('failed');
        ctxSip.stopRingTone();
        ctxSip.stopRingbackTone();
        ctxSip.setCallSessionStatus('Terminated');
        ctxSip.updateActiveLine(this, 'ended');
        ctxSip.callActiveID = null;
        ctxSip.deleteActiveLine(this.ctxid);

    },
    sessionOnEnded: function() {
        console.log('ended');
        ctxSip.stopRingTone();
        ctxSip.stopRingbackTone();
        ctxSip.setCallSessionStatus("");
        ctxSip.updateActiveLine(this, 'ended');
        ctxSip.callActiveID = null;
        ctxSip.deleteActiveLine(this.ctxid);
    },
    sessionOnMuted: function() {
        console.log('muted');
    },
    sessionOnUnMuted: function() {
        console.log('unmuted');
    },
    sessionOnConfirmed: function() {
        console.log('call confirmed');
    },

    phoneHoldButtonPressed : function(sessionId) {
        let call = ctxSip.widget.calls.find(o => o.id === sessionId);
        if (call === undefined) {
            return;
        }
        let s = call.session;
        if (s.isOnHold().local === true) {
            s.unhold();
        } else {
            s.hold();
        }
    },

    playDtmfTone : function(sessionId, digit) {
        let call = ctxSip.widget.calls.find(o => o.id === sessionId);
        if (call === undefined) {
            return;
        }
        try { ctxSip.dtmfTone.play(); } catch(e) { }
        let s = call.session;
        s.sendDTMF(digit);
    },

    sipHangUp : function(sessionid) {
        let s = ctxSip.Sessions[sessionid];
        if (!s || s.isEnded()) {
            return;
        }
        s.terminate();
    },

    newSession : function(newSess) {
        newSess.displayName = newSess.remote_identity.display_name || newSess.remote_identity.uri.user;
        newSess.ctxid       = newSess.id;
        let status;
        if (newSess.direction === 'incoming') {
            status = "Incoming: "+ newSess.displayName;
            ctxSip.startRingbackTone();
        } else {
            status = "Trying: "+ newSess.displayName;
            ctxSip.startRingTone();
        }
        ctxSip.Sessions[newSess.ctxid] = newSess;
        ctxSip.updateActiveLine(newSess, 'ringing');
        ctxSip.setCallSessionStatus(status);
    },

    /**
     * Отправка текстового сообщения.
     * @param text
     * @param target
     */
    sendMessage : function (text, target){
        let eventHandlers = {
            'succeeded': function(){ console.log('succeeded')},
            'failed':    function(){ console.log('failed') }
        };
        let options = {
            'eventHandlers': eventHandlers
        };
        let aor = ctxSip.makeAor(target);
        ctxSip.phone.sendMessage(aor, text, options);
    },

    getUserMediaSuccess : function(stream) {
        ctxSip.mediaExist = true;
    },
    getUserMediaFailure : function(e) {
        ctxSip.mediaExist = false;
        window.console.error('getUserMedia failed:', e);
        ctxSip.setError(true, 'Media Error.', 'You must allow access to your microphone.  Check the address bar.', true);
    },
    checkUserMedia: () => {
        navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.mediaDevices.getUserMedia;
        if (!navigator.getUserMedia) {
            console.log('You are using a browser that does not support the Media Capture API');
        }else{
            let constraints = { audio : true, video : false };
            try {
                navigator.getUserMedia(constraints).then(ctxSip.getUserMediaSuccess, ctxSip.getUserMediaFailure);
            } catch(err) {
                ctxSip.getUserMediaFailure(err);
            }
        }
    },
    init: function (settings){
        ctxSip.checkUserMedia();
        $(window).on("message", ctxSip.onWindowMessage);
    },
    onWindowMessage: (event) => {
        if(typeof event.originalEvent.data === 'undefined'){
            // Не корректные данные.
            return;
        }
        if(event.originalEvent.data.action === 'connect'){
            ctxSip.start(event.originalEvent.data);
        }
    }
}