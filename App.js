import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  FlatList
} from 'react-native';
import * as SQLite from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

// Open/create the database
const db = SQLite.openDatabaseSync('egg_inventory.db');

const App = () => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [producedEggs, setProducedEggs] = useState('');
  const [breakages, setBreakages] = useState('');
  const [soldEggs, setSoldEggs] = useState('');
  const [pricePerEgg, setPricePerEgg] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditName, setCreditName] = useState('');
  const [dailyRecords, setDailyRecords] = useState([]);
  const [summary, setSummary] = useState({
    totalProduced: 0,
    totalBreakages: 0,
    totalSold: 0,
    totalCashSales: 0,
    totalCredits: 0
  });

  // Initialize database with migration
  const initializeDatabase = useCallback(() => {
    console.log('Starting database initialization...');
    
    // First, check if table exists
    db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_records'")
      .then(tables => {
        if (tables.length === 0) {
          // Table doesn't exist, create new schema
          console.log('Creating new table with full schema...');
          return createNewTable();
        } else {
          // Table exists, check columns and migrate if needed
          console.log('Table exists, checking schema...');
          return checkAndMigrateSchema();
        }
      })
      .then(() => {
        console.log('Database ready, loading records...');
        loadDailyRecords();
      })
      .catch(error => {
        console.log('Database init error: ', error);
        // Fallback: try to create table
        createNewTable().then(() => loadDailyRecords());
      });
  }, []);

  // Create new table with all columns
  const createNewTable = () => {
    return db.runAsync(
      `CREATE TABLE IF NOT EXISTS daily_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        produced_eggs INTEGER DEFAULT 0,
        breakages INTEGER DEFAULT 0,
        sold_eggs INTEGER DEFAULT 0,
        price_per_egg REAL DEFAULT 0,
        credit_amount REAL DEFAULT 0,
        credit_name TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    ).then(() => {
      console.log('New table created with full schema');
    });
  };

  // Check existing schema and migrate if needed
  const checkAndMigrateSchema = () => {
    return db.getAllAsync("PRAGMA table_info(daily_records)")
      .then(columns => {
        const columnNames = columns.map(col => col.name);
        console.log('Existing columns:', columnNames);
        
        const migrations = [];
        
        // Add missing columns
        if (!columnNames.includes('sold_eggs')) {
          console.log('Adding sold_eggs column...');
          migrations.push(
            db.runAsync("ALTER TABLE daily_records ADD COLUMN sold_eggs INTEGER DEFAULT 0", [])
          );
        }
        
        if (!columnNames.includes('credit_amount')) {
          console.log('Adding credit_amount column...');
          migrations.push(
            db.runAsync("ALTER TABLE daily_records ADD COLUMN credit_amount REAL DEFAULT 0", [])
          );
        }
        
        if (!columnNames.includes('credit_name')) {
          console.log('Adding credit_name column...');
          migrations.push(
            db.runAsync("ALTER TABLE daily_records ADD COLUMN credit_name TEXT DEFAULT ''", [])
          );
        }
        
        // Also check for old columns that need updating
        if (columnNames.includes('credits')) {
          console.log('Migrating old credits column to credit_amount...');
          // First add new columns if they don't exist
          if (!columnNames.includes('credit_amount')) {
            migrations.push(
              db.runAsync("ALTER TABLE daily_records ADD COLUMN credit_amount REAL DEFAULT 0", [])
            );
          }
          // Copy data from old credits to new credit_amount
          migrations.push(
            db.runAsync("UPDATE daily_records SET credit_amount = credits WHERE credit_amount = 0 AND credits IS NOT NULL", [])
          );
        }
        
        return Promise.all(migrations);
      })
      .then(() => {
        console.log('Schema migration completed');
      });
  };

  // Calculate summary function
  const calculateSummary = useCallback(() => {
    db.getFirstAsync(
      `SELECT 
        COALESCE(SUM(produced_eggs), 0) as totalProduced,
        COALESCE(SUM(breakages), 0) as totalBreakages,
        COALESCE(SUM(sold_eggs), 0) as totalSold,
        COALESCE(SUM(sold_eggs * price_per_egg), 0) as totalCashSales,
        COALESCE(SUM(credit_amount), 0) as totalCredits
      FROM daily_records`
    ).then(result => {
      if (result) {
        setSummary(result);
      }
    }).catch(error => {
      console.log('Error calculating summary: ', error);
    });
  }, []);

  // Load daily records function
  const loadDailyRecords = useCallback(() => {
    db.getAllAsync('SELECT * FROM daily_records ORDER BY date DESC LIMIT 30')
      .then(records => {
        setDailyRecords(records);
        calculateSummary();
      })
      .catch(error => {
        console.log('Error loading records: ', error);
      });
  }, [calculateSummary]);

  // Initialize on component mount
  useEffect(() => {
    initializeDatabase();
  }, [initializeDatabase]);

  const saveDailyRecord = () => {
    if (!producedEggs || !pricePerEgg) {
      Alert.alert('Error', 'Please fill in produced eggs and price per egg');
      return;
    }

    const breakagesValue = parseInt(breakages) || 0;
    const soldEggsValue = parseInt(soldEggs) || 0;
    const creditAmountValue = parseFloat(creditAmount) || 0;
    const priceValue = parseFloat(pricePerEgg);
    
    // Validate sold eggs don't exceed available eggs
    const availableEggs = parseInt(producedEggs) - breakagesValue;
    if (soldEggsValue > availableEggs) {
      Alert.alert('Error', `Sold eggs (${soldEggsValue}) cannot exceed available eggs (${availableEggs})`);
      return;
    }

    db.runAsync(
      `INSERT OR REPLACE INTO daily_records 
       (date, produced_eggs, breakages, sold_eggs, price_per_egg, credit_amount, credit_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [date, parseInt(producedEggs), breakagesValue, soldEggsValue, priceValue, creditAmountValue, creditName]
    ).then((result) => {
      if (result.changes > 0) {
        Alert.alert('Success', 'Daily record saved successfully!');
        
        // Clear form and refresh data
        setProducedEggs('');
        setBreakages('');
        setSoldEggs('');
        setPricePerEgg('');
        setCreditAmount('');
        setCreditName('');
        loadDailyRecords();
      }
    }).catch(error => {
      console.log('Save error: ', error);
      Alert.alert('Error', 'Failed to save record: ' + error.message);
    });
  };

  const addCreditOnly = () => {
    if (!creditAmount || parseFloat(creditAmount) <= 0 || !creditName) {
      Alert.alert('Error', 'Please enter credit amount and customer name');
      return;
    }

    Alert.alert(
      'Add Credit Only',
      `Add credit of $${creditAmount} for ${creditName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: () => {
            // First check if record exists for this date
            db.getFirstAsync('SELECT * FROM daily_records WHERE date = ?', [date])
              .then(existingRecord => {
                if (existingRecord) {
                  // Update existing record
                  const newCreditAmount = (existingRecord.credit_amount || 0) + parseFloat(creditAmount);
                  const newCreditName = existingRecord.credit_name 
                    ? `${existingRecord.credit_name}, ${creditName}`
                    : creditName;
                  
                  return db.runAsync(
                    `UPDATE daily_records SET 
                      credit_amount = ?,
                      credit_name = ?
                     WHERE date = ?`,
                    [newCreditAmount, newCreditName, date]
                  );
                } else {
                  // Create new record with just credit info
                  return db.runAsync(
                    `INSERT INTO daily_records 
                     (date, produced_eggs, breakages, sold_eggs, price_per_egg, credit_amount, credit_name)
                     VALUES (?, 0, 0, 0, 0, ?, ?)`,
                    [date, parseFloat(creditAmount), creditName]
                  );
                }
              })
              .then((result) => {
                if (result.changes > 0) {
                  Alert.alert('Success', 'Credit added successfully!');
                  loadDailyRecords();
                  setCreditAmount('');
                  setCreditName('');
                }
              })
              .catch(error => {
                console.log('Error adding credit: ', error);
                Alert.alert('Error', 'Failed to add credit: ' + error.message);
              });
          }
        }
      ]
    );
  };

  const deleteRecord = (id) => {
    Alert.alert(
      'Delete Record',
      'Are you sure you want to delete this record?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            db.runAsync('DELETE FROM daily_records WHERE id = ?', [id])
              .then(() => {
                Alert.alert('Success', 'Record deleted successfully!');
                loadDailyRecords();
              })
              .catch(error => {
                console.log('Error deleting record: ', error);
              });
          }
        }
      ]
    );
  };

  const exportData = () => {
    db.getAllAsync('SELECT * FROM daily_records ORDER BY date')
      .then(records => {
        if (records.length === 0) {
          Alert.alert('Info', 'No data to export');
          return;
        }
        
        let csv = 'Date,Produced Eggs,Breakages,Sold Eggs,Remaining Eggs,Price Per Egg,Cash Sales,Credit Amount,Credit Name\n';
        
        records.forEach(record => {
          const remainingEggs = (record.produced_eggs || 0) - (record.breakages || 0) - (record.sold_eggs || 0);
          const cashSales = (record.sold_eggs || 0) * (record.price_per_egg || 0);
          
          csv += `${record.date},${record.produced_eggs || 0},${record.breakages || 0},${record.sold_eggs || 0},${remainingEggs},${record.price_per_egg || 0},${cashSales},${record.credit_amount || 0},"${record.credit_name || ''}"\n`;
        });
        
        Alert.alert(
          'Export Data',
          `${records.length} records ready for export.\n\nData has been logged to console.`,
          [{ text: 'OK' }]
        );
        
        console.log('CSV Data:\n', csv);
      })
      .catch(error => {
        console.log('Error exporting data: ', error);
      });
  };

  const resetDatabase = () => {
    Alert.alert(
      'Reset Database',
      'This will delete ALL data and recreate tables with new schema. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            db.runAsync('DROP TABLE IF EXISTS daily_records', [])
              .then(() => {
                console.log('Table dropped, recreating...');
                return createNewTable();
              })
              .then(() => {
                Alert.alert('Success', 'Database reset with new schema. Loading fresh...');
                loadDailyRecords();
              })
              .catch(error => {
                console.log('Error resetting database: ', error);
              });
          }
        }
      ]
    );
  };

  const renderRecordItem = ({ item }) => {
    const produced = item.produced_eggs || 0;
    const breakages = item.breakages || 0;
    const sold = item.sold_eggs || 0;
    const price = item.price_per_egg || 0;
    const credit = item.credit_amount || 0;
    const remainingEggs = produced - breakages - sold;
    const cashSales = sold * price;
    
    return (
      <View style={styles.recordItem}>
        <View style={styles.recordHeader}>
          <Text style={styles.recordDate}>{item.date}</Text>
          <TouchableOpacity onPress={() => deleteRecord(item.id)}>
            <Text style={styles.deleteButton}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.recordDetails}>
          <Text>Produced: {produced} eggs</Text>
          <Text>Breakages: {breakages} eggs</Text>
          <Text>Sold: {sold} eggs</Text>
          <Text>Remaining: {remainingEggs} eggs</Text>
          <Text>Price: ${price.toFixed(2)}/egg</Text>
          <Text style={styles.cashSalesText}>
            Cash Sales: ${cashSales.toFixed(2)}
          </Text>
          {credit > 0 && (
            <>
              <Text>Credit: ${credit.toFixed(2)}</Text>
              {item.credit_name && (
                <Text>Customer: {item.credit_name}</Text>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
      <StatusBar style="auto" />
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🥚 Egg Inventory System</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity onPress={resetDatabase} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>🔄 Reset DB</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>⚠️ Tap "Reset DB" to update database schema for new fields</Text>
        </View>

        {/* Summary Section */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Total Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Produced</Text>
              <Text style={styles.summaryValue}>{summary.totalProduced} eggs</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Breakages</Text>
              <Text style={styles.summaryValue}>{summary.totalBreakages} eggs</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Sold</Text>
              <Text style={styles.summaryValue}>{summary.totalSold} eggs</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Cash Sales</Text>
              <Text style={styles.summaryValue}>${summary.totalCashSales.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Credits</Text>
              <Text style={styles.summaryValue}>${summary.totalCredits.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Input Form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Daily Entry</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Produced Eggs</Text>
            <TextInput
              style={styles.input}
              value={producedEggs}
              onChangeText={setProducedEggs}
              keyboardType="number-pad"
              placeholder="Enter number of eggs"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Breakages</Text>
            <TextInput
              style={styles.input}
              value={breakages}
              onChangeText={setBreakages}
              keyboardType="number-pad"
              placeholder="Enter breakages (optional)"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Sold Eggs (Cash)</Text>
            <TextInput
              style={styles.input}
              value={soldEggs}
              onChangeText={setSoldEggs}
              keyboardType="number-pad"
              placeholder="Eggs sold for cash"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Price per Egg ($)</Text>
            <TextInput
              style={styles.input}
              value={pricePerEgg}
              onChangeText={setPricePerEgg}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Credit Amount ($)</Text>
            <TextInput
              style={styles.input}
              value={creditAmount}
              onChangeText={setCreditAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Customer Name (Credit)</Text>
            <TextInput
              style={styles.input}
              value={creditName}
              onChangeText={setCreditName}
              placeholder="Name of person with credit"
            />
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.saveButton} onPress={saveDailyRecord}>
              <Text style={styles.buttonText}>Save Daily Record</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.creditButton} onPress={addCreditOnly}>
              <Text style={styles.buttonText}>Add Credit Only</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Export Button */}
        <TouchableOpacity style={styles.exportButton} onPress={exportData}>
          <Text style={styles.exportButtonText}>📊 Export Data to CSV</Text>
        </TouchableOpacity>

        {/* Recent Records */}
        <View style={styles.recordsCard}>
          <View style={styles.recordsHeader}>
            <Text style={styles.recordsTitle}>Recent Records (Last 30 Days)</Text>
            <Text style={styles.recordsCount}>{dailyRecords.length} records</Text>
          </View>
          {dailyRecords.length === 0 ? (
            <Text style={styles.noRecords}>No records yet. Start by adding your first daily entry!</Text>
          ) : (
            <FlatList
              data={dailyRecords}
              renderItem={renderRecordItem}
              keyExtractor={item => item.id.toString()}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 10,
    marginBottom: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  resetButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: '#FFF3CD',
    borderColor: '#FFEEBA',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    color: '#856404',
    fontSize: 14,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  summaryItem: {
    width: '48%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  formCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 14,
    borderRadius: 6,
    marginRight: 8,
  },
  creditButton: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 14,
    borderRadius: 6,
    marginLeft: 8,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  exportButton: {
    backgroundColor: '#FF9800',
    padding: 14,
    borderRadius: 6,
    marginBottom: 16,
    alignItems: 'center',
  },
  exportButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  recordsCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  recordsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  recordsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  recordsCount: {
    fontSize: 14,
    color: '#666',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recordItem: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordDate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  deleteButton: {
    color: '#ff4444',
    fontSize: 18,
    fontWeight: 'bold',
  },
  recordDetails: {
    gap: 4,
  },
  cashSalesText: {
    fontWeight: 'bold',
    color: '#4CAF50',
    marginTop: 4,
  },
  noRecords: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: 20,
  },
});

// ⚠️ CRITICAL: ADD THESE TWO LINES AT THE END! ⚠️
import { registerRootComponent } from 'expo';
registerRootComponent(App);