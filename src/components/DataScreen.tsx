import { useState, useEffect } from 'react';
import { Database, Plus, Trash2, Save } from 'lucide-react';
import { listBases, listTables, listRecords, createRecord, updateRecord, deleteRecord } from '@/airtableops';
import { useNavigate } from 'react-router-dom';

import { Header } from './Header';

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

interface DataScreenProps {
  sidebarCollapsed: boolean;
}

export function DataScreen({ sidebarCollapsed }: DataScreenProps) {
  const [bases, setBases] = useState<AirtableBase[]>([]);
  const [selectedBase, setSelectedBase] = useState<AirtableBase | null>(null);
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<AirtableTable | null>(null);
  const [records, setRecords] = useState<AirtableRecord[]>([]);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<{ id: string; fields: Record<string, any> } | null>(null);
  const [newRecord, setNewRecord] = useState<Record<string, any> | null>(null);

  const navigate = useNavigate();

  // Fetch bases on component mount
  useEffect(() => {
    const fetchBases = async () => {
      setLoading(true);
      try {
        const basesList = await listBases();
        setBases(basesList);
        if (basesList.length > 0) {
          setSelectedBase(basesList[0]);
        }
      } catch (err) {
        setError('Failed to fetch bases');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBases();
  }, []);

  // Fetch tables when a base is selected
  useEffect(() => {
    if (!selectedBase) return;

    const fetchTables = async () => {
      setLoading(true);
      try {
        const tablesList = await listTables(selectedBase.id);
        setTables(tablesList);
        if (tablesList.length > 0) {
          setSelectedTable(tablesList[0]);
        } else {
          setSelectedTable(null);
        }
      } catch (err) {
        setError('Failed to fetch tables');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, [selectedBase]);

  // Fetch records when a table is selected
  useEffect(() => {
    if (!selectedBase || !selectedTable) return;

    const fetchRecords = async () => {
      setLoading(true);
      try {
        const recordsList = await listRecords(selectedBase.id, selectedTable.id);
        setRecords(recordsList);

        console.log("Records from Airtable:", JSON.stringify(recordsList, null, 2));
        
        // Extract field names from the first record or set empty array if no records
        if (recordsList.length > 0) {
          // Extract all fields including nested object fields
          const extractedFields: string[] = [];
          const firstRecord = recordsList[0];
          
          Object.entries(firstRecord.fields).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              // For objects, add each key as a separate field
              Object.keys(value).forEach(nestedKey => {
                extractedFields.push(`${key}.${nestedKey}`);
              });
            } else {
              extractedFields.push(key);
            }
          });
          
          setFieldNames(extractedFields);
        } else {
          setFieldNames([]);
        }
      } catch (err) {
        setError('Failed to fetch records');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRecords();
  }, [selectedBase, selectedTable]);

  const handleBaseChange = (baseId: string) => {
    const base = bases.find(b => b.id === baseId);
    if (base) {
      setSelectedBase(base);
      setSelectedTable(null);
      setRecords([]);
      setFieldNames([]);
    }
  };

  const handleTableChange = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (table) {
      setSelectedTable(table);
      setRecords([]);
      setFieldNames([]);
    }
  };

  const handleEditRecord = (record: AirtableRecord) => {
    setEditingRecord({
      id: record.id,
      fields: { ...record.fields }
    });
  };

  const handleSaveRecord = async () => {
    if (!selectedBase || !selectedTable || !editingRecord) return;

    setLoading(true);
    try {
      // Reconstruct nested objects before saving
      const reconstructedFields = reconstructNestedObjects(editingRecord.fields);
      
      await updateRecord(selectedBase.id, selectedTable.id, editingRecord.id, reconstructedFields);
      
      // Refresh records
      const updatedRecords = await listRecords(selectedBase.id, selectedTable.id);
      setRecords(updatedRecords);
      setEditingRecord(null);
    } catch (err) {
      setError('Failed to update record');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!selectedBase || !selectedTable) return;

    setLoading(true);
    try {
      await deleteRecord(selectedBase.id, selectedTable.id, recordId);
      
      // Refresh records
      const updatedRecords = await listRecords(selectedBase.id, selectedTable.id);
      setRecords(updatedRecords);
    } catch (err) {
      setError('Failed to delete record');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRecord = () => {
    // Initialize a new record with empty values for each field
    const emptyRecord: Record<string, any> = {};
    fieldNames.forEach(field => {
      emptyRecord[field] = '';
    });
    setNewRecord(emptyRecord);
  };

  const handleSaveNewRecord = async () => {
    if (!selectedBase || !selectedTable || !newRecord) return;

    setLoading(true);
    try {
      // Reconstruct nested objects before saving
      const reconstructedRecord = reconstructNestedObjects(newRecord);
      console.log("Sending to Airtable:", reconstructedRecord);
      
      await createRecord(selectedBase.id, selectedTable.id, reconstructedRecord);
      
      // Refresh records
      const updatedRecords = await listRecords(selectedBase.id, selectedTable.id);
      setRecords(updatedRecords);
      setNewRecord(null);
    } catch (err) {
      setError('Failed to create record');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
    setNewRecord(null);
  };

  

  // Helper function to reconstruct nested objects from dot notation fields
  const reconstructNestedObjects = (flatFields: Record<string, any>): Record<string, any> => {
    console.log("Flat fields before reconstruction:", flatFields);
    
    const result: Record<string, any> = {};
    const nestedObjects: Record<string, Record<string, any>> = {};
    
    // First pass: identify all fields and prepare nested objects
    Object.entries(flatFields).forEach(([key, value]) => {
      if (key.includes('.')) {
        const [parentField, childField] = key.split('.');
        if (!nestedObjects[parentField]) {
          nestedObjects[parentField] = {};
        }
        nestedObjects[parentField][childField] = value;
      } else {
        // Non-nested field
        result[key] = value;
      }
    });
    
    // Second pass: check if we need to handle special Airtable formats
    for (const [parentField, nestedObj] of Object.entries(nestedObjects)) {
      // If this is an Airtable record reference (has id field)
      if ('id' in nestedObj) {
        // For Airtable, references might need to be just the ID
        if (Object.keys(nestedObj).length === 1 && nestedObj.id) {
          result[parentField] = nestedObj.id;
        } else {
          // If it's a more complex object, check if it's a collaborator
          if ('email' in nestedObj || 'name' in nestedObj) {
            // This might be a collaborator format
            if (nestedObj.id) {
              // If we have an ID, use that for the reference
              result[parentField] = nestedObj.id;
            } else {
              // Otherwise use the full object (but clean up empty values)
              const cleanedObj = Object.fromEntries(
                Object.entries(nestedObj).filter(([_, v]) => v !== '')
              );
              if (Object.keys(cleanedObj).length > 0) {
                result[parentField] = cleanedObj;
              }
            }
          } else {
            // Regular nested object
            result[parentField] = nestedObj;
          }
        }
      } else {
        // Regular nested object
        result[parentField] = nestedObj;
      }
    }
    
    console.log("Reconstructed fields:", result);
    return result;
  };

  const handleFieldChange = (recordId: string, fieldName: string, value: any) => {
    // Check if it's a nested field (contains a dot)
    const isNestedField = fieldName.includes('.');
    
    if (editingRecord && editingRecord.id === recordId) {
      if (isNestedField) {
        const [parentField, childField] = fieldName.split('.');
        const parentObject = { ...editingRecord.fields[parentField] };
        parentObject[childField] = value;
        
        setEditingRecord({
          ...editingRecord,
          fields: {
            ...editingRecord.fields,
            [parentField]: parentObject
          }
        });
      } else {
        setEditingRecord({
          ...editingRecord,
          fields: {
            ...editingRecord.fields,
            [fieldName]: value
          }
        });
      }
    } else if (newRecord) {
      if (isNestedField) {
        const [parentField, childField] = fieldName.split('.');
        const parentObject = { ...newRecord[parentField] };
        parentObject[childField] = value;
        
        setNewRecord({
          ...newRecord,
          [parentField]: parentObject
        });
      } else {
        setNewRecord({
          ...newRecord,
          [fieldName]: value
        });
      }
    }
  };

  // Helper function to get field value (handles nested fields)
  const getFieldValue = (record: Record<string, any>, fieldName: string): any => {
    if (fieldName.includes('.')) {
      const [parentField, childField] = fieldName.split('.');
      const parentValue = record[parentField];
      
      if (typeof parentValue === 'object' && parentValue !== null) {
        return parentValue[childField];
      }
      return '';
    }
    return record[fieldName];
  };

  return (
    <>
    <Header sidebarCollapsed={sidebarCollapsed} showAgents={false} />
    <div className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
      <div className="mx-auto" 
        style={{ 
          maxWidth: 'min(1480px, 100%)',
          padding: '0 2rem'
        }}>
        <main className="py-8">
          <div className="bg-white/30 dark:bg-blue-950/30 backdrop-blur-sm p-6 rounded-xl 
            border border-violet-200/50 dark:border-blue-800/50 
            shadow-xl shadow-violet-200/20 dark:shadow-blue-900/20
            hover:shadow-violet-300/30 dark:hover:shadow-blue-800/30">
            
            <div className="flex items-center mb-6">
              <Database className="h-6 w-6 text-violet-600 dark:text-blue-400 mr-2" />
              <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
                Airtable Data
              </h1>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
                {error}
                <button 
                  className="ml-2 text-red-500 hover:text-red-700"
                  onClick={() => setError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            {
              !loading && bases.length === 0 && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
                  <span className="block text-sm">
                    Failed to load bases - maybe you need to put your Airtable access token in the <a onClick={() => navigate('/settings')} className="cursor-pointer text-violet-500 hover:text-violet-600 dark:text-blue-400 hover:dark:text-blue-500">settings</a>?
                  </span>
                </div>
              )
            }

            <div className="flex flex-wrap gap-4 mb-6">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Base
                </label>
                <select
                  className="w-full p-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200 dark:border-blue-800 rounded-lg text-gray-900 dark:text-gray-100"
                  value={selectedBase?.id || ''}
                  onChange={(e) => handleBaseChange(e.target.value)}
                  disabled={loading || bases.length === 0}
                >
                  {bases.length === 0 ? (
                    <option value="">No bases available</option>
                  ) : (
                    bases.map((base) => (
                      <option key={base.id} value={base.id}>
                        {base.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Table
                </label>
                <select
                  className="w-full p-2 bg-white/50 dark:bg-slate-800/50 border border-violet-200 dark:border-blue-800 rounded-lg text-gray-900 dark:text-gray-100"
                  value={selectedTable?.id || ''}
                  onChange={(e) => handleTableChange(e.target.value)}
                  disabled={loading || tables.length === 0}
                >
                  {tables.length === 0 ? (
                    <option value="">No tables available</option>
                  ) : (
                    tables.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {selectedBase && selectedTable && (
              <div className="mb-4 flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                  {selectedTable.name} ({records.length} records)
                </h2>
                <button
                  onClick={handleCreateRecord}
                  disabled={loading || fieldNames.length === 0}
                  className="flex items-center px-3 py-2 bg-violet-500 hover:bg-violet-600 text-white rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Record
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-700 dark:border-blue-400"></div>
              </div>
            ) : (
              <>
                {newRecord && (
                  <div className="mb-6 p-4 bg-violet-50 dark:bg-blue-900/30 rounded-lg border border-violet-200 dark:border-blue-800">
                    <h3 className="text-md font-medium text-violet-800 dark:text-blue-300 mb-3">New Record</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                      {fieldNames.map((fieldName) => (
                        <div key={fieldName} className="mb-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {fieldName}
                          </label>
                          <input
                            type="text"
                            value={String(getFieldValue(newRecord, fieldName) || '')}
                            onChange={(e) => handleFieldChange('new', fieldName, e.target.value)}
                            className="w-full p-2 bg-white/70 dark:bg-slate-800/70 border border-violet-200 dark:border-blue-800 rounded-lg"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveNewRecord}
                        className="flex items-center px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {records.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-violet-200 dark:divide-blue-800">
                      <thead className="bg-violet-50/50 dark:bg-blue-900/50">
                        <tr>
                          {fieldNames.map((fieldName) => (
                            <th
                              key={fieldName}
                              scope="col"
                              className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider border"
                            >
                              {fieldName}
                            </th>
                          ))}
                          <th scope="col" className="py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white/30 dark:bg-slate-900/30 divide-y divide-violet-200 dark:divide-blue-800">
                        {records.map((record) => (
                          <tr key={record.id}>
                            {fieldNames.map((fieldName) => (
                              <td
                                key={`${record.id}-${fieldName}`}
                                className="px-3 py-4 border whitespace-nowrap text-sm text-gray-800 dark:text-gray-200 cursor-pointer"
                                onClick={() => handleEditRecord(record)}
                              >
                                {editingRecord && editingRecord.id === record.id ? (
                                  <input
                                    type="text"
                                    value={String(getFieldValue(editingRecord.fields, fieldName) || '')}
                                    onChange={(e) => handleFieldChange(record.id, fieldName, e.target.value)}
                                    className="w-full p-1 bg-white/70 dark:bg-slate-800/70 border border-violet-200 dark:border-blue-800 rounded"
                                  />
                                ) : (
                                  <span>
                                    {String(getFieldValue(record.fields, fieldName) || '')}
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="px-3 py-4 whitespace-nowrap text-right text-sm font-medium">
                              {editingRecord && editingRecord.id === record.id ? (
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={handleCancelEdit}
                                    className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={handleSaveRecord}
                                    className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-200"
                                  >
                                    Save
                                  </button>
                                </div>
                              ) : (
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => handleEditRecord(record)}
                                    className="text-violet-600 hover:text-violet-900 dark:text-blue-400 dark:hover:text-blue-200"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRecord(record.id)}
                                    className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  selectedBase && selectedTable && (
                    <div className="text-center p-8 bg-gray-50/50 dark:bg-slate-800/50 rounded-lg">
                      <p className="text-gray-600 dark:text-gray-400">No records found in this table.</p>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
    </>
  );
}
