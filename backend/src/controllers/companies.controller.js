const { query } = require("../db");

async function listCompanies(_req, res) {
  const result = await query(`SELECT Id, Name FROM dbo.Companies ORDER BY Name`);
  res.json({
    companies: result.recordset.map((row) => ({
      id: row.Id ?? row.id,
      name: row.Name ?? row.name ?? ""
    }))
  });
}

module.exports = { listCompanies };
