const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB接続（環境変数から読み込む）
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

const threadSchema = new mongoose.Schema({
    dat: { type: String, unique: true },
    discoveredAt: { type: Date, default: Date.now }
});
const Thread = mongoose.model('Thread', threadSchema);

// 3分おきの監視ロジック
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

// 期間指定API: /list?from=YYMMDDHHmm&to=YYMMDDHHmm
app.get('/list', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");

    const parseDate = (s) => new Date(2000+parseInt(s.slice(0,2)), s.slice(2,4)-1, s.slice(4,6), s.slice(6,8), s.slice(8,10));
    
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) }
        }).sort({ discoveredAt: 1 });
        res.json(dats.map(t => t.dat));
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/', (req, res) => res.send("Running..."));
app.listen(PORT, () => monitor());
