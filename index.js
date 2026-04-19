const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

const threadSchema = new mongoose.Schema({
    dat: { type: String, unique: true },
    discoveredAt: { type: Date, default: Date.now },
    aggregated: { type: Boolean, default: false }
});
const Thread = mongoose.model('Thread', threadSchema);

async function monitor() {
    try {
        const res = await axios.get('https://bbs.eddibb.cc/liveedge/subject.txt', { 
            responseType: 'arraybuffer', timeout: 7000 
        });
        const content = iconv.decode(res.data, 'shift-jis');
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/(\d+)\.dat/);
            if (match) {
                await Thread.updateOne(
                    { dat: match[1] },
                    { $setOnInsert: { discoveredAt: new Date() } },
                    { upsert: true }
                );
            }
        }
        console.log(`[${new Date().toLocaleTimeString()}] Checked subject.txt`);
    } catch (e) { console.error("Monitor error:", e.message); }
}

setInterval(monitor, 3 * 60 * 1000);

const parseDate = (s) => {
    const d = new Date(2000+parseInt(s.slice(0,2)), s.slice(2,4)-1, s.slice(4,6), s.slice(6,8), s.slice(8,10));
    return new Date(d.getTime() - 9 * 60 * 60 * 1000);
};

// 未集計のみ返してフラグを立てる
app.get('/list', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) },
            aggregated: { $ne: true }
        }).sort({ discoveredAt: 1 });
        const ids = dats.map(t => t.dat);
        if (ids.length > 0) {
            await Thread.updateMany(
                { dat: { $in: ids } },
                { $set: { aggregated: true } }
            );
        }
        res.json(ids);
    } catch (e) { res.status(500).send(e.message); }
});

// 全部返してフラグを立てる
app.get('/list/all', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) }
        }).sort({ discoveredAt: 1 });
        const ids = dats.map(t => t.dat);
        if (ids.length > 0) {
            await Thread.updateMany(
                { dat: { $in: ids } },
                { $set: { aggregated: true } }
            );
        }
        res.json(ids);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/', (req, res) => res.send("Running..."));
app.listen(PORT, () => monitor());
