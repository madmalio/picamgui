# README

## About

This is the official Wails React template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.

## Wi-Fi sudoers setup (portable)

If PiCam runs as a non-root account, allow passwordless scan/connect commands for that app user.

1. Run `sudo visudo -f /etc/sudoers.d/picam-wifi`.
2. Add rules with your local app account and absolute binary paths:

```sudoers
<app_user> ALL=(root) NOPASSWD: /usr/sbin/iw
<app_user> ALL=(root) NOPASSWD: /usr/sbin/iwlist
<app_user> ALL=(root) NOPASSWD: /usr/bin/nmcli
```

3. Validate with `sudo -n /usr/sbin/iw dev wlan0 scan` and `sudo -n /usr/bin/nmcli device wifi list ifname wlan0`.
