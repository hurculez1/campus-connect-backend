const { pool } = require('../config/database');
const logger = require('../utils/logger');

async function cleanupTestAccounts() {
    try {
        const [result] = await pool.query(
            "DELETE FROM users WHERE email LIKE '%ai%' OR email LIKE '%test%' OR first_name LIKE '%Test%' OR last_name LIKE '%Test%'"
        );
        console.log(`Successfully deleted ${result.affectedRows} test accounts.`);
        process.exit(0);
    } catch (error) {
        console.error('Cleanup failed:', error);
        process.exit(1);
    }
}

cleanupTestAccounts();
