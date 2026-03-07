require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    try {
        const [rows] = await pool.query("SHOW COLUMNS FROM users WHERE Field='id'");
        console.log(rows);
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
check();
