// Vercel Serverless Function: ทุก request /api/* ถูก rewrite มาที่นี่ (ดู vercel.json)
// แล้วส่งต่อให้ Express app ตัวเดียวกับที่ใช้รันในเครื่อง
import app from '../server.js';

export default app;
