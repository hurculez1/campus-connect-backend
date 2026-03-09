const { pool } = require('./config/database');
async function run() {
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM users');
    console.log(JSON.stringify(cols, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
