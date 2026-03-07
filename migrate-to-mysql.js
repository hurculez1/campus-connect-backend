const fs = require('fs');
const path = require('path');

const dirs = ['controllers', 'routes', 'middleware', 'services', 'utils'];

function migrateFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. replace const { rows: xxx } = await pool.query(...) -> const [xxx] = await pool.query(...)
    content = content.replace(/const\s+\{\s*rows\s*:\s*([a-zA-Z0-9_]+)\s*\}\s*=\s*await\s+pool\.query\((.*?)\);/gs, 'const [$1] = await pool.query($2);');

    // 2. replace const { rows } = await pool.query(...) -> const [rows] = await pool.query(...)
    content = content.replace(/const\s+\{\s*rows\s*\}\s*=\s*await\s+pool\.query\((.*?)\);/gs, 'const [rows] = await pool.query($1);');

    // 3. remove RETURNING id
    content = content.replace(/RETURNING\s+id/gi, '');

    // 4. pg placeholders $1, $2 to ?
    content = content.replace(/\$\d+/g, '?');

    // 5. NOW() + INTERVAL '1 month'
    content = content.replace(/NOW\(\)\s*\+\s*INTERVAL\s*'1\s+month'/gi, 'DATE_ADD(NOW(), INTERVAL 1 MONTH)');

    // 6. insertId mapping for generated ID
    content = content.replace(/([a-zA-Z0-9_]+)\[0\]\.id/g, '$1.insertId');

    // 7. Extra handling for non-destructured assignments:
    // const result = await pool.query(...) -> const [result] = await pool.query(...)
    // Only if not already destructured.

    if(content !== original) {
        fs.writeFileSync(filePath, content);
        console.log('Migrated', filePath);
    }
}

dirs.forEach(d => {
    let p = path.join(__dirname, d);
    if(fs.existsSync(p)) {
        fs.readdirSync(p).forEach(f => {
            if(f.endsWith('.js')) {
                migrateFile(path.join(p, f));
            }
        });
    }
});
console.log('Done migration script');
