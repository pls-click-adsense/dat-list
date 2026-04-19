const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

// --- DB設定 ---
const threadSchema = new mongoose.Schema({
    dat: { type: String, unique: true },
    posterId: { type: String }, 
    discoveredAt: { type: Date, default: Date.now },
    aggregated: { type: Boolean, default: false },
    aggregatedAt: { type: Date, default: null }
});
const Thread = mongoose.model('Thread', threadSchema);

// --- メイン処理（監視） ---
async function monitor() {
    try {
        const res = await axios.get('https://bbs.eddibb.cc/liveedge/subject-metadent.txt', {
            responseType: 'arraybuffer', 
            timeout: 7000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Render-Monitor)' } // 念のためブラウザっぽく
        });
        const content = iconv.decode(res.data, 'shift-jis');
        const lines = content.split('\n');
        
        let newCount = 0;
        for (const line of lines) {
            const match = line.match(/^(\d+)\.dat<>.*\[(.+?)★\]/);
            
            if (match) {
                const dat = match[1];
                const posterId = match[2];

                const result = await Thread.updateOne(
                    { dat: dat },
                    { 
                        $setOnInsert: { 
                            discoveredAt: new Date(),
                            posterId: posterId 
                        } 
                    },
                    { upsert: true }
                );
                if (result.upsertedCount > 0) newCount++;
            }
        }
        console.log(`[${new Date().toLocaleString('ja-JP')}] Checked. New threads: ${newCount}`);
    } catch (e) {
        console.error("Monitor error:", e.message);
    }
}

// --- サーバー起動 & DB接続 ---
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB connected');
        
        // TTLインデックスの再設定
        try {
            await Thread.collection.dropIndex("aggregatedAt_1");
        } catch (e) {
            // インデックスがない場合はスルー
        }

        await Thread.collection.createIndex(
            { aggregatedAt: 1 },
            { 
                expireAfterSeconds: 180 * 24 * 60 * 60, 
                partialFilterExpression: { aggregatedAt: { $type: "date" } } 
            }
        );
        console.log('180-day TTL index ready');
        
        // 1分おきのループを開始
        monitor(); // 初回実行
        setInterval(monitor, 60000); // 1分(60,000ms)おき
    })
    .catch(err => console.error("DB Connection Error:", err));

// --- APIエンドポイント ---
const parseDate = (s) => {
    // yymmddhhmm形式をDateオブジェクトに変換（JST考慮）
    const d = new Date(2000 + parseInt(s.slice(0, 2)), s.slice(2, 4) - 1, s.slice(4, 6), s.slice(6, 8), s.slice(8, 10));
    return new Date(d.getTime() - 9 * 60 * 60 * 1000);
};

// 未取得のリストを取得してフラグを立てる
app.get('/list', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) },
            aggregated: { $ne: true }
        }).sort({ discoveredAt: 1 });

        const threadData = dats.map(t => ({ dat: t.dat, posterId: t.posterId }));

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

// 全リスト取得
app.get('/list/all', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).send("from/to required");
    try {
        const dats = await Thread.find({
            discoveredAt: { $gte: parseDate(from), $lte: parseDate(to) }
        }).sort({ discoveredAt: 1 });

        res.json(dats.map(t => ({ dat: t.dat, posterId: t.posterId })));
    } catch (e) { res.status(500).send(e.message); }
});

// GASの監視用 & 起動確認
app.get('/', (req, res) => {
    res.send("Dat-List Monitor is Running!");
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
