const express = require('express');
const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/api/familyHierarchy', (req, res) => {
    const familyHierarchy = require('./familyHierarchy.json');
    res.json(familyHierarchy);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);