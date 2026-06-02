export default {
  name: "20260602-add-mcp-access",
  async run(runner) {
    const queries = [
      `ALTER TABLE saved_connection ADD COLUMN mcpAccess varchar(8) not null default 'read'`,
      `ALTER TABLE used_connection  ADD COLUMN mcpAccess varchar(8) not null default 'read'`,
    ];
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      await runner.query(query);
    }
  }
};
