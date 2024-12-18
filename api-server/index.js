const express = require('express')
const { generateSlug } = require('random-word-slugs')
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
const { Server } = require('socket.io')
const cors = require('cors')
const { z } = require('zod')
const { PrismaClient } = require('@prisma/client')
const { createClient } = require('@clickhouse/client')
const { Kafka } = require('kafkajs')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

require('dotenv').config();

const app = express()
const PORT = process.env.PORT || 8000

const prisma = new PrismaClient({})

const io = new Server({ cors: '*' })

const kafka = new Kafka({
    clientId: `api-server`,
    brokers: [process.env.KAFKA_BROKER],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')],
    },
    sasl: {
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
        mechanism: 'plain'
    }
})

const client = createClient({
    host: process.env.CLICKHOUSE_HOST,
    database: process.env.CLICKHOUSE_DATABASE,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
})

const consumer = kafka.consumer({ groupId: 'api-server-logs-consumer' })

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', JSON.stringify({ log: `Subscribed to ${channel}` }))
    })
})

io.listen(9001, () => console.log('Socket Server 9001'))

// io.to(`logs:${DEPLOYMENT_ID}`).emit('message', JSON.stringify({ log }));

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
})

const config = {
    CLUSTER: process.env.ECS_CLUSTER,
    TASK: process.env.ECS_TASK
}

app.use(express.json())
app.use(cors())

app.post('/project', async (req, res) => {
    const schema = z.object({
        name: z.string(),
        githubURL: z.string().url()
    })
    const safeParseResult = schema.safeParse(req.body)

    if (safeParseResult.error) return res.status(400).json({ error: safeParseResult.error })

    const { name, githubURL } = safeParseResult.data

    let subDomain = name.trim() ? name : generateSlug();

    let isUnique = false;
    while (!isUnique) {
        const existingProject = await prisma.project.findUnique({
            where: { subDomain }
        });

        if (!existingProject) {
            isUnique = true;
        } else {
            subDomain = generateSlug();
        }
    }

    const project = await prisma.project.create({
        data: {
            name,
            githubURL,
            subDomain
        }
    })

    return res.json({ status: 'success', data: { project } })

})

app.post('/deploy', async (req, res) => {
    const { projectId } = req.body

    const project = await prisma.project.findUnique({ where: { id: projectId } })

    if (!project) return res.status(404).json({ error: 'Project not found' })

    // Check if there is no running deployement
    const deployment = await prisma.deployement.create({
        data: {
            project: { connect: { id: projectId } },
            status: 'QUEUED',
        }
    })

    // Spin the container
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: ['subnet-03b645ef7fd62a9f5', 'subnet-07b5352308fd8b0c5', 'subnet-08d28fa49db1ee367'],
                securityGroups: ['sg-0543bf6df48adb49f'],
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'builder-image',
                    environment: [
                        { name: 'GITHUB_REPOSITORY__URL', value: project.githubURL },
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYMENT_ID', value: deployment.id },
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command);

    return res.json({ status: 'queued', data: { deploymentId: deployment.id } })

})


app.get('/logs/:id', async (req, res) => {
    const id = req.params.id;
    const logs = await client.query({
        query: `SELECT event_id, deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String}`,
        query_params: {
            deployment_id: id
        },
        format: 'JSONEachRow'
    })

    const rawLogs = await logs.json()

    return res.json({ logs: rawLogs })
})

async function initkafkaConsumer() {
    await consumer.connect();
    await consumer.subscribe({ topics: ['container-logs'], fromBeginning: true })

    await consumer.run({

        eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {

            const messages = batch.messages;
            console.log(`Received ${messages.length} messages..`)
            for (const message of messages) {
                if (!message.value) continue;
                const stringMessage = message.value.toString()
                const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage)
                console.log(`Emitting log to channel: logs:${DEPLOYMENT_ID}`);
                io.to(`logs:${DEPLOYMENT_ID}`).emit('message', JSON.stringify({ log }));
                try {
                    const { query_id } = await client.insert({
                        table: 'log_events',
                        values: [{ event_id: uuidv4(), deployment_id: DEPLOYMENT_ID, log }],
                        format: 'JSONEachRow'
                    })
                    console.log(query_id)
                    resolveOffset(message.offset)
                    await commitOffsetsIfNecessary(message.offset)
                    await heartbeat()
                } catch (err) {
                    console.log(err)
                }

            }
        }
    })
}

initkafkaConsumer()

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))