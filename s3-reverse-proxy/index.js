const express = require('express')
const httpProxy = require('http-proxy')
const { PrismaClient } = require('@prisma/client')

require('dotenv').config();

const prisma = new PrismaClient()
const app = express()
const PORT = 8000

const BASE_PATH = process.env.BASE_PATH

const proxy = httpProxy.createProxy()

app.use(async (req, res) => {
    const hostname = req.hostname;
    const subDomain = hostname.split('.')[0];

    const project = await prisma.project.findUnique({
        where: { subDomain: subDomain },
        select: { id: true }
    })

    if (!project) {
        return res.status(404).send('Project Not Found')
    }

    const id = project.id

    const resolvesTo = `${BASE_PATH}/${id}`

    return proxy.web(req, res, { target: resolvesTo, changeOrigin: true })
})

proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url;
    if (url === '/')
        proxyReq.path += 'index.html'
})

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`))