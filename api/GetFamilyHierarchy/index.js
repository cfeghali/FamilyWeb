const fs = require('fs');
const path = require('path');

module.exports = async function (context, req) {
    const filePath = path.join(__dirname, '..', 'familyHierarchy.json');
    const familyHierarchy = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    context.res = {
        status: 200,
        body: familyHierarchy,
        headers: {
            'Content-Type': 'application/json'
        }
    };
};
