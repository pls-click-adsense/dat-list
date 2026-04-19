const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

const threadSchema = new mongoose.Schema({
    dat: { type: String, unique: true },
    posterId: { type: String }, 
    discoveredAt: { type: Date, default: Date.now },
    aggregated: { type: Boolean, default: false },
    aggregatedAt: { type: Date, default: null }
});
const Thread = mongoose.model('Thread', threadSchema);

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB connected');
        
        try {
            await Thread.collection.dropIndex("aggregatedAt_1");
            console.log('Old index dropped');
        } catch (e) {
            console.log('No old index to drop or already updated');
        }

        await Thread.collection.createIndex(
            { aggregatedAt: 1 },
            { 
                expireAfterSeconds: 180 * 24 * 60 * 60, 
                partialFilterExpression: { aggregatedAt: { $type: "date" } } 
            }
        );
        console.log('New 180-day TTL index created');
        
        monitor();
        scheduleNextMonitor();
    })
    .catch(err => console.error(err));

async function monitor() {
    try {
        const res = await axios.get('https://bbs.eddibb.cc/liveedge/subject-metadent.txt', {
            responseType: 'arraybuffer', timeout: 7000
        });
        const content = iconv.decode(res.data, 'shift-jis');
        const lines = content.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^(\d+)\.dat<>.*\[(.+?)★\]/);
            
            if (match) {
                const dat = match[1];
                const posterId = match[2];

                await Thread.updateOne(
                    { dat: dat },
                    { 
                        $setOnInsert: { 
                            discoveredAt: new Date(),
                            posterId: posterId 
                        } 
                    },
                    { upsert: true }
                );
            }
        }
        console.log(`[${new Date().toLocaleTimeString()}] Checked subject-metadent.txt`);
    } catch (e) { console.error("Monitor error:", e.message); }
}

function scheduleNextMonitor() {
    const now = new Date();
    const secondsInCycle = (now.getMinutes() % 10) * 60 + now.getSeconds();
    
    const targets = [
        1 * 60 + 0,  // x1:00
        5 * 60 + 0,  // x5:00
        9 * 60 + 40  // x9:40
    ];
    
    let diff = targets.find(t => t > secondsInCycle);
    if (diff === undefined) diff = targets[0] + 10 * 60;
    diff -= secondsInCycle;
    
    setTimeout(async () => {
        await monitor();
        scheduleNextMonitor();
    }, diff * 1000);
}

const parseDate = (s) => {
    const d = new Date(2000 + parseInt(s.slice(0, 2)), s.slice(2, 4) - 1, s.slice(4, 6), s.slice(6, 8), s.slice(8, 10));
    return new Date(d.getTime() - 9 * 60 * 60 * 1000);
};

app.get('/list', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) },
            aggregated: { $ne: true }
        }).sort({ discoveredAt: 1 });

        const threadData = dats.map(t => ({
            dat: t.dat,
            posterId: t.posterId
        }));

        if (threadData.length > 0) {
            const ids = threadData.map(t => t.dat);
            await Thread.updateMany(
                { dat: { $in: ids } },
                { $set: { aggregated: true, aggregatedAt: new Date() } }
            );
        }
        res.json(threadData);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/list/all', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) }
        }).sort({ discoveredAt: 1 });

        const threadData = dats.map(t => ({
            dat: t.dat,
            posterId: t.posterId
        }));

        if (threadData.length > 0) {
            const ids = threadData.map(t => t.dat);
            await Thread.updateMany(
                { dat: { $in: ids } },
                { $set: { aggregated: true, aggregatedAt: new Date() } }
            );
        }
        res.json(threadData);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/', (req, res) => res.send("Running..."));
app.listen(PORT);
