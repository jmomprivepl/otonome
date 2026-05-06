import { Handle, Position, NodeProps } from 'reactflow';

function isJsonArray(str: string): boolean {
  try {
    const obj = JSON.parse(str);
    return Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object';
  } catch {
    return false;
  }
}

export function OutputNode({ data }: NodeProps) {
  // Try to parse content as JSON array if it's a string
  let records: any[] = [];
  let fieldNames: string[] = [];
  let isTableView = false;

  if (typeof data.content === 'string' && isJsonArray(data.content)) {
    try {
      records = JSON.parse(data.content);
      if (records.length > 0) {
        // Get all unique field names from all records
        const fieldsSet = new Set<string>();
        records.forEach(record => {
          if (record.fields) {
            Object.keys(record.fields).forEach(key => fieldsSet.add(key));
          }
        });
        fieldNames = Array.from(fieldsSet);
        isTableView = true;
      }
    } catch {
      // If parsing fails, fall back to text view
      isTableView = false;
    }
  }

  const getFieldValue = (fields: Record<string, any>, fieldName: string): string => {
    const value = fields[fieldName];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="shadow-md rounded-md border-2 w-[600px] border-violet-200 dark:border-sky-800 bg-gradient-to-br from-white to-violet-100 dark:from-sky-900 dark:to-indigo-800">
      <Handle type="target" position={Position.Left} className="!bg-violet-500" />
      <div className="p-2 border-b border-violet-200 bg-violet-50 dark:bg-sky-950 dark:border-sky-800 flex justify-between items-center">
        <div className="font-bold text-lg text-violet-700 dark:text-violet-100">{data.label}</div>
      </div>
      <div className="flex flex-col min-h-[100px] max-h-[400px] overflow-auto">
        {isTableView ? (
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
                </tr>
              </thead>
              <tbody className="bg-white/30 dark:bg-slate-900/30 divide-y divide-violet-200 dark:divide-blue-800">
                {records.map((record, idx) => (
                  <tr key={record.id || idx}>
                    {fieldNames.map((fieldName) => (
                      <td
                        key={`${record.id || idx}-${fieldName}`}
                        className="px-3 py-4 border whitespace-nowrap text-sm text-gray-800 dark:text-gray-200"
                      >
                        {getFieldValue(record.fields || record, fieldName)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
            {data.content || 'Loading results...'}
          </div>
        )}
      </div>
    </div>
  );
}