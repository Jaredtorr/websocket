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

            try {
                // Parsear el mensaje recibido (JSON)
                const command = JSON.parse(message);
                console.log("Comando JSON recibido:", command);

                // Verifica el comando y actúa en consecuencia
                if (command.command) {
                    // Log del mensaje antes de enviarlo a RabbitMQ
                    console.log("Enviando mensaje a RabbitMQ:", command);

                    // Convertir el mensaje a JSON y enviarlo a RabbitMQ
                    const jsonMessage = JSON.stringify(command);  // Asegurarse de que sea un string JSON
                    channel.sendToQueue("car_commands", Buffer.from(jsonMessage), { persistent: true });

                    // Enviar el comando a MQTT (enviar al ESP32)
                    mqttClient.publish("car/control", jsonMessage); // Enviar al topic "car/control"
                } else {
                    console.log("Comando inválido.");
                }
            } catch (error) {
                console.error("Error al parsear el mensaje recibido:", error);
            }
        });

        // Función para consumir mensajes desde la cola de datos de sensores
        const consumeMessages = async () => {
            const queue = "sensor_data";
            await channel.consume(queue, (msg) => {
                if (msg !== null) {
                    // Convertir el buffer a string
                    const messageString = msg.content.toString();

                    // Intentar parsear el mensaje como JSON
                    try {
                        const sensorData = JSON.parse(messageString);
                        console.log("Enviando datos al WebSocket:", sensorData);

                        // Enviar datos al frontend como JSON
                        ws.send(JSON.stringify(sensorData));  // Enviar como un string JSON

                        // Confirmar mensaje consumido
                        channel.ack(msg);
                    } catch (error) {
                        console.error("Error al parsear el mensaje de los sensores:", error);
                    }
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
    console.log(`Servidor WebSocket en http://0.0.0.0:${port}`);
});


    app.server.on("upgrade", (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    });
}

// Iniciar el servidor
startServer();
