const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");
const amqp = require("amqplib");
const mqtt = require("mqtt");

const app = express();
const port = 3000;

app.use(cors());

const wss = new WebSocket.Server({ noServer: true });

// Conexión a RabbitMQ
async function setupRabbitMQ() {
    const conn = await amqp.connect("amqp://toledo:12345@35.170.134.124:5672/");
    const channel = await conn.createChannel();

    // Declarar colas para datos de sensores y comandos
    await channel.assertQueue("sensor_data", { durable: true });
    await channel.assertQueue("car_commands", { durable: true });

    return { conn, channel };
}

// Conexión a MQTT
const mqttClient = mqtt.connect("mqtt://35.170.134.124:1883");

mqttClient.on("connect", () => {
    console.log("Conectado a MQTT Broker");
});

// Función para iniciar el servidor WebSocket y RabbitMQ
async function startServer() {
    const { channel } = await setupRabbitMQ();

    wss.on("connection", async (ws) => {
        console.log("Nuevo cliente WebSocket conectado");

        // Enviar comandos desde el frontend al backend a través de RabbitMQ y MQTT
        ws.on("message", async (message) => {
            console.log("Comando recibido del frontend:", message);

            // Enviar comando a RabbitMQ (backend Go procesará este comando)
            channel.sendToQueue("car_commands", Buffer.from(message), { persistent: true });

            // Enviar el comando a MQTT (enviar al ESP32)
            mqttClient.publish("car/control", message); // Enviar al topic "car/control"
        });

        // Función para consumir mensajes desde la cola de datos de sensores
        const consumeMessages = async () => {
            const queue = "sensor_data";
            await channel.consume(queue, (msg) => {
                if (msg !== null) {
                    console.log("Enviando datos al WebSocket:", msg.content.toString());
                    ws.send(msg.content.toString());  // Enviar datos al frontend
                    channel.ack(msg);  // Confirmar mensaje consumido
                }
            });
        };

        consumeMessages();

        ws.on("close", () => {
            console.log("Cliente WebSocket desconectado");
        });
    });

    // Configurar el servidor HTTP para WebSocket
    app.server = app.listen(port, "0.0.0.0", () => {
        console.log(`Servidor WebSocket en http://44.205.54.88:${port}`);
    });

    app.server.on("upgrade", (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    });
}

// Iniciar el servidor
startServer();
