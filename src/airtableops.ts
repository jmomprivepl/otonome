import Airtable from 'airtable';

interface AirtableBase {
  id: string;
  name: string;
}

interface AirtableTable {
  id: string;
  name: string;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

// Get the most up-to-date API key
const getApiKey = () => {
  const devKey = import.meta.env.VITE_AIRTABLE_API_TOKEN;
  const userKey = window.localStorage.getItem('airtable-key');
  return (devKey !== undefined ? devKey : userKey !== null ? userKey : 'place your token here');
};

// Get a fresh Airtable instance
export const getAirtable = () => {
  return new Airtable({ apiKey: getApiKey() });
};

// List all bases
export const listBases = async (): Promise<AirtableBase[]> => {
  try {
    const key = getApiKey();
    const response = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    return data.bases.map((base: any) => ({
      id: base.id,
      name: base.name
    }));
  } catch (error) {
    console.error('Error fetching bases:', error);
    return [];
  }
};

// List all tables in a base
export const listTables = async (baseId: string): Promise<AirtableTable[]> => {
  try {
    const key = getApiKey();
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    return data.tables.map((table: any) => ({
      id: table.id,
      name: table.name
    }));
  } catch (error) {
    console.error('Error fetching tables:', error);
    return [];
  }
};

// List records in a table
export const listRecords = async (baseId: string, tableId: string): Promise<AirtableRecord[]> => {
  try {
    const airtable = getAirtable();
    const records = await airtable.base(baseId).table(tableId).select().all();
    return records.map(record => ({
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    }));
  } catch (error) {
    console.error('Error fetching records:', error);
    return [];
  }
};

// Create a new record
export const createRecord = async (baseId: string, tableId: string, fields: Record<string, any>) => {
  try {
    const airtable = getAirtable();
    return await airtable.base(baseId).table(tableId).create(fields);
  } catch (error) {
    console.error('Error creating record:', error);
    throw error;
  }
};

// Update a record
export const updateRecord = async (baseId: string, tableId: string, recordId: string, fields: Record<string, any>) => {
  try {
    const airtable = getAirtable();
    return await airtable.base(baseId).table(tableId).update(recordId, fields);
  } catch (error) {
    console.error('Error updating record:', error);
    throw error;
  }
};

// Delete a record
export const deleteRecord = async (baseId: string, tableId: string, recordId: string): Promise<boolean> => {
  try {
    const airtable = getAirtable();
    await airtable.base(baseId).table(tableId).destroy(recordId);
    return true;
  } catch (error) {
    console.error('Error deleting record:', error);
    return false;
  }
};

export async function testAirtableOperations() {
  try {
    // List all bases
    console.log('Fetching all bases...');
    const bases = await listBases();
    console.log('Available bases:', bases);

    if (bases.length > 0) {
      const firstBaseId = bases[0].id;
      console.log(`\nFetching tables for base ${firstBaseId}...`);
      
      // List tables in the first base
      const tables = await listTables(firstBaseId);
      console.log('Available tables:', tables);

      if (tables.length > 0) {
        const firstTableId = tables[0].id;
        console.log(`\nFetching records from table ${firstTableId}...`);
        
        // List records in the first table
        const records = await listRecords(firstBaseId, firstTableId);
        console.log('Records:', records);

        // Create a new record
        console.log('\nCreating a new record...');
        const newRecord = await createRecord(firstBaseId, firstTableId, {
          Description: 'This is a new task',
          Name: 'New Task',
          Status: 'Todo'
        });
        console.log('Created record:', newRecord);

        // Update an existing record
        console.log('\nUpdating an existing record...');
        const updatedRecord = await updateRecord(firstBaseId, firstTableId, newRecord.id, {
          Description: 'This is an updated task',
          Name: 'Updated Task',
          Status: 'In progress'
        });
        console.log('Updated record:', updatedRecord);

        // Delete a record
        console.log('\nDeleting a record...');
        const deleted = await deleteRecord(firstBaseId, firstTableId, newRecord.id);
        console.log('Record deleted:', deleted);
      }
    }
  } catch (error) {
    console.error('Error during testing:', error);
  }
}
