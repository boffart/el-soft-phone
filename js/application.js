$(document).ready(() => {
    // Ready translated locale messages
    const messages = {
        en: {
            settings: {
                pbxHost: 'Host',
                currentPhone: 'Login',
                sipPassword: 'Password',
                save: 'Save'
            },
            callCommands: {
                answer: 'Answer',
                hangup: 'Hangup',
                hold: 'Hold',
            },
            message: {
                callInputPlaceholder: 'Enter numder...'
            }
        },
        ru: {
            settings: {
                pbxHost: 'Адрес PBX',
                currentPhone: 'Логин',
                sipPassword: 'Пароль',
                save: 'Сохранить',
            },
            callCommands: {
                answer: 'Ответить',
                hold: 'Удержание',
                hangup: 'Завершить',
            },
            message: {
                callInputPlaceholder: 'Введите номер...'
            }
        }
    }
    const i18n   = new VueI18n({
        locale: 'ru',
        fallbackLocale: 'ru',
        messages,
    })
    const widget = new Vue({
        i18n,
        el: '#app',
        data: {
            status: '...',
            settings: {
                currentPhone: '',
                sipPassword: '',
                pbxHost: '',
                isActive: false,
            },
            calls: [
                // {
                //     id: 1,
                //     display_name: 'Alexey',
                //     user: '201',
                //     direction: 'outgoing',
                //     isIncoming: false,
                //     status: 'Call',
                //     start : new Date().getTime(),
                //     duration: '',
                // },
                // {
                //     id: 2,
                //     display_name: 'Petr',
                //     user: '202',
                //     direction: 'incoming',
                //     isIncoming: true,
                //     status: 'Call',
                //     start : new Date().getTime(),
                //     duration: '',
                // },
            ]
        },
        methods: {
            saveSettings: function () {
                let settings = JSON.stringify({
                    currentPhone: this.settings.currentPhone,
                    sipPassword: this.settings.sipPassword,
                    pbxHost: this.settings.pbxHost
                });
                localStorage.setItem('settings', settings);
            },
            showSettings: function () {
                this.settings.isActive = !this.settings.isActive;
            },
            loadSettings: function () {
                if (typeof localStorage.settings !== 'undefined') {
                    let self = this;
                    let oldSettings = JSON.parse(localStorage.settings);
                    $.each(oldSettings, function (key, value) {
                        if (typeof self.settings[key] === 'undefined') {
                            return;
                        }
                        self.settings[key] = value;
                    });
                    setInterval(() => {
                        $.each(this.calls, function (key, value) {
                            let seconds = (new Date().getTime() - self.calls[key]['start']); // Пример количества секунд
                            let formatString;
                            if (seconds < 60000) {
                                formatString = 's';
                            } else if (seconds < 3600000) {
                                formatString = 'mm:ss';
                            } else {
                                formatString = 'HH:mm:ss';
                            }
                            self.calls[key]['duration'] = moment.utc(seconds).format(formatString);
                        });
                        }, 1000,
                    );
                }
            },
            answer: function (event){
                let callId = $(event.target).attr('data-session-id');
                ctxSip.answer(callId);
            },
            hangup: function (event){
                let callId = $(event.target).attr('data-session-id');
                ctxSip.sipHangUp(callId);
            },
            hold: function (event){
                let callId = $(event.target).attr('data-session-id');
                ctxSip.phoneHoldButtonPressed(callId);
            },
            dial: function (event){
                let dst = $(event.target).val();
                ctxSip.dial(dst);
            },
            dtmf: function (event){
                let sessionId = $(event.target).parents('.container.message.segment').find('kbd.numpad').attr('data-session-id')
                let val = $(event.target).text();
                ctxSip.playDtmfTone(sessionId, val);
            },
            showDialPad: function (event){
                let sessionId = $(event.target).attr('data-session-id');
                if(sessionId === undefined){
                    sessionId = $(event.target).parent().attr('data-session-id');
                }
                let labelNumpad = $(`kbd.label.numpad[data-session-id="${sessionId}"]`);
                labelNumpad.popup({
                    position: 'top center',
                    popup : $('.popup.numpad'),
                    on    : 'click'
                });
                labelNumpad.popup('show')
            },

        }
    });
    widget.loadSettings();

    ctxSip.start(widget);
});