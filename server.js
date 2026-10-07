"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const yaml = require("js-yaml");
const { Client } = require("ssh2");
const { WebSocketServer } = require("ws");

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const config = yaml.load(
    fs.readFileSync(path.join(__dirname, "config.yaml"), "utf8")
);

// --------------------------------------------------
// Express
// --------------------------------------------------

const app = express();

// Fichiers xterm.js
app.use(
    "/xterm.css",
    express.static(
        path.join(
            __dirname,
            "node_modules/@xterm/xterm/css/xterm.css"
        )
    )
);

app.use(
    "/xterm.js",
    express.static(
        path.join(
            __dirname,
            "node_modules/@xterm/xterm/lib/xterm.js"
        )
    )
);

app.use(
    "/addon-fit.js",
    express.static(
        path.join(
            __dirname,
            "node_modules/@xterm/addon-fit/lib/addon-fit.js"
        )
    )
);

// Interface Web
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

const wss = new WebSocketServer({
    server
});

// --------------------------------------------------
// Connexion SSH
// --------------------------------------------------

function startSSH(ws) {

    const ssh = new Client();

    let terminal = null;

    function send(type, data) {

        if (ws.readyState === ws.OPEN) {

            ws.send(
                JSON.stringify({
                    type,
                    data
                })
            );
        }
    }

    ssh.on("ready", () => {

        send("status", "SSH connecté");

        ssh.shell(
            {
                term: "xterm-256color",
                cols: 120,
                rows: 40
            },
            (err, shell) => {

                if (err) {

                    send(
                        "error",
                        "Impossible d'ouvrir le terminal : " +
                        err.message
                    );

                    ssh.end();

                    return;
                }

                terminal = shell;

                // Sortie du terminal
                shell.on("data", data => {

                    send(
                        "output",
                        data.toString("utf8")
                    );

                });

                // --------------------------------------------------
                // Connexion au screen existant
                // --------------------------------------------------

                const screenName =
                    String(config.screen.name)
                        .replace(/[^a-zA-Z0-9_.:-]/g, "");

                shell.write(
                    `screen -xS ${screenName}\n`
                );
            }
        );
    });

    ssh.on("error", err => {

        send(
            "error",
            "Erreur SSH : " + err.message
        );

    });

    ssh.on("close", () => {

        send(
            "status",
            "Connexion SSH fermée"
        );

    });

    // --------------------------------------------------
    // Configuration SSH
    // --------------------------------------------------

    const sshConfig = {

        host: config.ssh.host,

        port: config.ssh.port || 22,

        username: config.ssh.username,

        keepaliveInterval:
            config.ssh.keepaliveInterval || 10000,

        readyTimeout:
            config.ssh.readyTimeout || 20000
    };

    try {

        sshConfig.privateKey =
            fs.readFileSync(
                path.resolve(config.ssh.privateKey),
                "utf8"
            );

    } catch (err) {

        send(
            "error",
            "Impossible de lire la clé SSH : " +
            err.message
        );

        return;
    }

    if (config.ssh.passphrase) {

        sshConfig.passphrase =
            config.ssh.passphrase;
    }

    ssh.connect(sshConfig);

    // --------------------------------------------------
    // Données provenant du navigateur
    // --------------------------------------------------

    ws.on("message", raw => {

        if (!terminal)
            return;

        let message;

        try {

            message =
                JSON.parse(raw.toString());

        } catch {

            return;
        }

        // Caractères tapés au clavier
        if (
            message.type === "input" &&
            typeof message.data === "string"
        ) {

            terminal.write(message.data);
        }

        // Redimensionnement du terminal
        if (message.type === "resize") {

            const cols = Number(message.cols);
            const rows = Number(message.rows);

            if (
                Number.isInteger(cols) &&
                Number.isInteger(rows) &&
                cols > 0 &&
                rows > 0
            ) {

                terminal.setWindow(
                    rows,
                    cols,
                    0,
                    0
                );
            }
        }
    });

    // --------------------------------------------------
    // Fermeture navigateur
    // --------------------------------------------------

    ws.on("close", () => {

        try {

            if (terminal)
                terminal.end();

            ssh.end();

        } catch (_) {}

    });
}

// --------------------------------------------------
// WebSocket
// --------------------------------------------------

wss.on("connection", ws => {

    if (ws.readyState === ws.OPEN) {

        ws.send(
            JSON.stringify({
                type: "status",
                data: "Connexion SSH..."
            })
        );
    }

    startSSH(ws);
});

// --------------------------------------------------
// Serveur
// --------------------------------------------------

const host =
    config.web.host || "127.0.0.1";

const port =
    config.web.port || 3000;

server.listen(
    port,
    host,
    () => {

        console.log("");
        console.log(
            `Console Web : http://${host}:${port}`
        );

        console.log(
            `SSH         : ${config.ssh.username}@${config.ssh.host}`
        );

        console.log(
            `Screen      : ${config.screen.name}`
        );

        console.log("");
    }
);
