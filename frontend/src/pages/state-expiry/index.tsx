import { useEffect, useState } from 'react';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { IntegratedContextualHeader } from '../../components/layout/IntegratedContextualHeader';
import { getLabApiClient } from '../../api';
import { GetStateExpiryInfoRequest } from '../../api/gen/backend/pkg/api/proto/lab_api_pb';
import { StateExpiryInfo } from '../../api/gen/backend/pkg/server/proto/state_expiry/state_expiry_pb';
import { ChartWithStats, NivoLineChart, NivoPieChart } from '../../components/charts';
import { protoInt64 } from '@bufbuild/protobuf';

interface StateExpiryData {
  totalEOAAccounts: number;
  totalContractAccounts: number;
  totalStorageSlots: number;
  topContractsBySlots: Array<{ address: string; slots: number }>;
  topContractsByExpiredSlots: Array<{ address: string; expiredSlots: number }>;
  overallExpiryPercentage: number;
  contractAccountsExpiryPercentage: number;
  eoaAccountsExpiryPercentage: number;
  storageSlotsExpiryPercentage: number;
  accountsAccessSeries: Array<{ blockWindow: number; firstAccess: number; lastAccess: number }>;
  storageAccessSeries: Array<{ blockWindow: number; firstAccess: number; lastAccess: number }>;
  expiryBlockWindow: number;
}

// Helper function to generate tick values at million intervals from a numeric range
const generateMillionTickValues = (values: number[]) => {
  if (values.length === 0) return [];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const startMillion = Math.floor(minValue / 1000000) * 1000000;
  const endMillion = Math.ceil(maxValue / 1000000) * 1000000;

  const ticks = [];
  for (let i = startMillion; i < endMillion; i += 1000000) {
    if (i >= 0) {
      // Include zero and positive values
      ticks.push(i);
    }
  }

  return ticks;
};

// Helper function to get all Y-axis values from access series data
const getAccessValues = (
  data: Array<{ blockWindow: number; firstAccess: number; lastAccess: number }>,
) => {
  const values: number[] = [];
  data.forEach(d => {
    values.push(d.firstAccess, d.lastAccess);
  });
  return values;
};

export default function StateExpiryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StateExpiryData | null>(null);
  const [network] = useState('mainnet');

  const transformStateExpiryData = (info: StateExpiryInfo): StateExpiryData => {
    const accounts = info.accounts;
    const storage = info.storage;

    // Convert bigint values to numbers for calculations
    const totalAccounts = Number(accounts?.totalAccounts || protoInt64.zero);
    const totalContractAccounts = Number(accounts?.totalContractAccounts || protoInt64.zero);
    const expiredAccounts = Number(accounts?.expiredAccounts || protoInt64.zero);
    const expiredContracts = Number(accounts?.expiredContracts || protoInt64.zero);
    const totalStorageSlots = Number(storage?.totalStorageSlots || protoInt64.zero);
    const expiredStorageSlots = Number(storage?.expiredStorageSlots || protoInt64.zero);

    // Calculate derived metrics
    const totalEOAAccounts = totalAccounts - totalContractAccounts;
    const expiredEOAAccounts = expiredAccounts - expiredContracts;

    // Calculate percentages
    const overallExpiryPercentage = totalAccounts > 0 ? (expiredAccounts / totalAccounts) * 100 : 0;
    const contractAccountsExpiryPercentage =
      totalContractAccounts > 0 ? (expiredContracts / totalContractAccounts) * 100 : 0;
    const eoaAccountsExpiryPercentage =
      totalEOAAccounts > 0 ? (expiredEOAAccounts / totalEOAAccounts) * 100 : 0;
    const storageSlotsExpiryPercentage =
      totalStorageSlots > 0 ? (expiredStorageSlots / totalStorageSlots) * 100 : 0;

    // Transform contract data
    const topContractsBySlots = info.topContractsBySlots.slice(0, 3).map(contract => ({
      address: contract.contractAddress,
      slots: Number(contract.totalSlots),
    }));

    const topContractsByExpiredSlots = info.topContractsByExpiredSlots
      .slice(0, 3)
      .map(contract => ({
        address: contract.contractAddress,
        expiredSlots: Number(contract.expiredSlots),
      }));

    // Transform access series data
    const accountsAccessSeries = info.accountsAccessSeries.map(entry => ({
      blockWindow: Number(entry.blockWindowStart),
      firstAccess: Number(entry.firstAccessCount),
      lastAccess: Number(entry.lastAccessCount),
    }));

    const storageAccessSeries = info.storageAccessSeries.map(entry => ({
      blockWindow: Number(entry.blockWindowStart),
      firstAccess: Number(entry.firstAccessCount),
      lastAccess: Number(entry.lastAccessCount),
    }));

    const expiryBlockWindow = Number(info.expiryBlockWindow);

    return {
      totalEOAAccounts,
      totalContractAccounts,
      totalStorageSlots,
      topContractsBySlots,
      topContractsByExpiredSlots,
      overallExpiryPercentage,
      contractAccountsExpiryPercentage,
      eoaAccountsExpiryPercentage,
      storageSlotsExpiryPercentage,
      accountsAccessSeries,
      storageAccessSeries,
      expiryBlockWindow,
    };
  };

  useEffect(() => {
    const fetchStateExpiryData = async () => {
      try {
        setLoading(true);
        const client = await getLabApiClient();
        const request = new GetStateExpiryInfoRequest({ network });
        const response = await client.getStateExpiryInfo(request);

        if (response.data) {
          const transformedData = transformStateExpiryData(response.data);
          setData(transformedData);
        }
      } catch (err) {
        console.error('Error fetching state expiry data:', err);
        setError('Failed to load state expiry data');
      } finally {
        setLoading(false);
      }
    };

    fetchStateExpiryData();
  }, [network]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!data) {
    return <ErrorState message="No data available" />;
  }

  return (
    <div className="container mx-auto">
      <IntegratedContextualHeader
        title="State Expiry Analysis"
        description="Comprehensive analysis of Ethereum state expiry metrics including account statistics, storage utilization, and access patterns."
      />

      <div className="space-y-4">
        {/* First Row: Donut Chart Center with 6 Cards in 2 Side Columns */}
        <section className="mb-8">
          <div className="grid grid-cols-12 gap-6 items-stretch">
            {/* Left Column: Account Statistics (3 columns) */}
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-between h-full">
              {/* Total EOA Accounts */}
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">
                    Total EOA Accounts
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalEOAAccounts.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Total Contract Accounts */}
              <div className="flex-1 my-4 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">
                    Total Contract Accounts
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalContractAccounts.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Total Storage Slots */}
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">
                    Total Storage Slots
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalStorageSlots.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Center Column: Overall Expiry Donut Chart (6 columns) */}
            <div className="col-span-12 lg:col-span-6 flex flex-col h-full">
              <h3 className="text-3xl font-sans font-bold text-primary mb-6 text-center">
                Overall Expiry
              </h3>
              <div className="flex-1 min-h-[600px] relative">
                <NivoPieChart
                  data={[
                    {
                      id: 'Expired',
                      label: 'Expired',
                      value: data.overallExpiryPercentage,
                      color: '#FF6B35',
                    },
                    {
                      id: 'Active',
                      label: 'Active',
                      value: 100 - data.overallExpiryPercentage,
                      color: '#0088FE',
                    },
                  ]}
                  innerRadius={0.6}
                  padAngle={1}
                  cornerRadius={3}
                  activeOuterRadiusOffset={12}
                  colors={['#FF6B35', '#0088FE']}
                  borderWidth={2}
                  borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
                  arcLinkLabelsSkipAngle={10}
                  arcLinkLabelsTextColor="#FFFFFF"
                  arcLinkLabelsThickness={3}
                  arcLinkLabelsColor={{ from: 'color' }}
                  arcLabelsSkipAngle={10}
                  arcLabelsTextColor="#FFFFFF"
                  valueFormat=".1f"
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                  theme={{
                    labels: {
                      text: {
                        fontSize: 16,
                        fontWeight: 'bold',
                      },
                    },
                  }}
                  tooltip={({ datum }: any) => (
                    <div className="bg-surface border border-default rounded-lg p-3 shadow-lg">
                      <div className="text-sm font-mono">
                        <div className="font-bold text-primary">{datum.label}</div>
                        <div className="text-accent">{datum.value.toFixed(2)}%</div>
                      </div>
                    </div>
                  )}
                />
                {/* Center text overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-5xl font-mono font-bold text-warning">
                      {data.overallExpiryPercentage.toFixed(2)}%
                    </div>
                    <div className="text-lg font-mono text-secondary">Expired</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Expiry Percentages (3 columns) */}
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-between h-full">
              {/* EOA Accounts Expiry */}
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">EOA Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.eoaAccountsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Contract Accounts Expiry */}
              <div className="flex-1 my-4 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">Contract Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.contractAccountsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Storage Slots Expiry */}
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-xl font-sans font-bold text-primary mb-3">Storage Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.storageSlotsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Second Row: Top Contracts in 2 Columns */}
        <section className="mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 3 Contracts by Storage Slots */}
            <div>
              <h3 className="text-xl font-sans font-bold text-primary mb-4">
                Top 3 Contracts by Storage Slots
              </h3>
              <div className="space-y-3">
                {data.topContractsBySlots.map((contract, index) => (
                  <div
                    key={contract.address}
                    className="flex justify-between items-center p-3 bg-surface/50 rounded-lg"
                  >
                    <div>
                      <div className="text-sm font-mono text-secondary">#{index + 1}</div>
                      <div
                        className="text-xs font-mono text-tertiary truncate max-w-[300px]"
                        title={contract.address}
                      >
                        {contract.address}
                      </div>
                    </div>
                    <div className="text-lg font-mono font-bold text-accent">
                      {contract.slots.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top 3 Contracts by Expired Storage Slots */}
            <div>
              <h3 className="text-xl font-sans font-bold text-primary mb-4">
                Top 3 Contracts by Expired Slots
              </h3>
              <div className="space-y-3">
                {data.topContractsByExpiredSlots.map((contract, index) => (
                  <div
                    key={contract.address}
                    className="flex justify-between items-center p-3 bg-surface/50 rounded-lg"
                  >
                    <div>
                      <div className="text-sm font-mono text-secondary">#{index + 1}</div>
                      <div
                        className="text-xs font-mono text-tertiary truncate max-w-[300px]"
                        title={contract.address}
                      >
                        {contract.address}
                      </div>
                    </div>
                    <div className="text-lg font-mono font-bold text-error">
                      {contract.expiredSlots.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Access Patterns Charts */}
        <section className="mb-16">
          {/* <h2 className="text-2xl font-sans font-bold text-primary mb-6">Access Patterns</h2> */}
          <div className="space-y-8">
            {/* Accounts Access Series Chart */}
            <ChartWithStats
              title="Accounts Access Patterns"
              description={`First and last access patterns for accounts (showing ${data.accountsAccessSeries.length} data points)`}
              chart={
                <NivoLineChart
                  data={[
                    {
                      id: 'Last Access',
                      data: data.accountsAccessSeries.map(point => ({
                        x: point.blockWindow,
                        y: point.lastAccess,
                      })),
                    },
                    {
                      id: 'First Access',
                      data: data.accountsAccessSeries.map(point => ({
                        x: point.blockWindow,
                        y: point.firstAccess,
                      })),
                    },
                  ]}
                  axisBottom={{
                    legend: 'Block Window',
                    legendOffset: 36,
                    legendPosition: 'middle',
                    tickValues: generateMillionTickValues(
                      data.accountsAccessSeries.map(d => d.blockWindow),
                    ),
                    format: (value: any) => {
                      const numValue = Number(value);
                      return `${(numValue / 1000000).toFixed(0)}M`;
                    },
                  }}
                  axisLeft={{
                    legend: 'Access Count',
                    legendOffset: -40,
                    legendPosition: 'middle',
                    tickValues: generateMillionTickValues(
                      getAccessValues(data.accountsAccessSeries),
                    ),
                    format: (value: any) => {
                      const numValue = Number(value);
                      if (numValue === 0) return '0';
                      return `${(numValue / 1000000).toFixed(0)}M`;
                    },
                  }}
                  colors={['#0088FE', '#FF6B35']}
                  pointSize={0}
                  enableGridX={false}
                  enableGridY={false}
                  enableSlices={'x'}
                  sliceTooltip={({ slice }: any) => {
                    // Points are in the order they were defined in the data array
                    const firstAccessPoint = slice.points[0]; // First Access series
                    const lastAccessPoint = slice.points[1]; // Last Access series
                    return (
                      <div className="bg-surface border border-default rounded-lg p-3 shadow-lg">
                        <div className="text-sm font-mono">
                          <div className="font-bold mb-2 text-primary">
                            Block Window: {firstAccessPoint.data.x.toLocaleString()}
                          </div>
                          <div className="mb-1" style={{ color: '#FF6B35' }}>
                            First Access Count: {firstAccessPoint.data.y.toLocaleString()}
                          </div>
                          <div style={{ color: '#0088FE' }}>
                            Last Access Count: {lastAccessPoint.data.y.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                  markers={[
                    {
                      axis: 'x',
                      value: data.expiryBlockWindow,
                      lineStyle: {
                        stroke: '#FFFFFF',
                        strokeWidth: 2,
                        strokeDasharray: '5 5',
                      },
                      legend: 'expiry threshold',
                      legendOrientation: 'vertical',
                      textStyle: {
                        fill: '#FFFFFF',
                        fontSize: 12,
                      },
                    },
                  ]}
                  legends={[
                    {
                      anchor: 'top-left',
                      direction: 'column',
                      justify: true,
                      translateX: 15,
                      translateY: 0,
                      itemsSpacing: 2,
                      itemDirection: 'left-to-right',
                      itemWidth: 100,
                      itemHeight: 20,
                      symbolSize: 12,
                      symbolShape: 'circle',
                    },
                  ]}
                />
              }
              series={[
                {
                  name: 'First Access',
                  color: '#0088FE',
                  min: Math.min(...data.accountsAccessSeries.map(p => p.firstAccess)),
                  avg: Math.round(
                    data.accountsAccessSeries.reduce((sum, p) => sum + p.firstAccess, 0) /
                      data.accountsAccessSeries.length,
                  ),
                  max: Math.max(...data.accountsAccessSeries.map(p => p.firstAccess)),
                  last:
                    data.accountsAccessSeries[data.accountsAccessSeries.length - 1]?.firstAccess ||
                    0,
                },
                {
                  name: 'Last Access',
                  color: '#FF6B35',
                  min: Math.min(...data.accountsAccessSeries.map(p => p.lastAccess)),
                  avg: Math.round(
                    data.accountsAccessSeries.reduce((sum, p) => sum + p.lastAccess, 0) /
                      data.accountsAccessSeries.length,
                  ),
                  max: Math.max(...data.accountsAccessSeries.map(p => p.lastAccess)),
                  last:
                    data.accountsAccessSeries[data.accountsAccessSeries.length - 1]?.lastAccess ||
                    0,
                },
              ]}
              height={400}
              showSeriesTable={false}
            />

            {/* Storage Access Series Chart */}
            <ChartWithStats
              title="Storage Access Patterns"
              description={`First and last access patterns for storage (showing ${data.storageAccessSeries.length} data points)`}
              chart={
                <NivoLineChart
                  data={[
                    {
                      id: 'Last Access',
                      data: data.storageAccessSeries.map(point => ({
                        x: point.blockWindow,
                        y: point.lastAccess,
                      })),
                    },
                    {
                      id: 'First Access',
                      data: data.storageAccessSeries.map(point => ({
                        x: point.blockWindow,
                        y: point.firstAccess,
                      })),
                    },
                  ]}
                  axisBottom={{
                    legend: 'Block Window',
                    legendOffset: 36,
                    legendPosition: 'middle',
                    tickValues: generateMillionTickValues(
                      data.storageAccessSeries.map(d => d.blockWindow),
                    ),
                    format: (value: any) => {
                      const numValue = Number(value);
                      return `${(numValue / 1000000).toFixed(0)}M`;
                    },
                  }}
                  axisLeft={{
                    legend: 'Access Count',
                    legendOffset: -40,
                    legendPosition: 'middle',
                    tickValues: generateMillionTickValues(
                      getAccessValues(data.storageAccessSeries),
                    ),
                    format: (value: any) => {
                      const numValue = Number(value);
                      if (numValue === 0) return '0';
                      return `${(numValue / 1000000).toFixed(0)}M`;
                    },
                  }}
                  colors={['#0088FE', '#FF6B35']}
                  pointSize={0}
                  enableGridX={false}
                  enableGridY={false}
                  enableSlices={'x'}
                  sliceTooltip={({ slice }: any) => {
                    const firstAccessPoint = slice.points[0]; // First Access series
                    const lastAccessPoint = slice.points[1]; // Last Access series
                    return (
                      <div className="bg-surface border border-default rounded-lg p-3 shadow-lg">
                        <div className="text-sm font-mono">
                          <div className="font-bold mb-2 text-primary">
                            Block Window: {firstAccessPoint.data.x.toLocaleString()}
                          </div>
                          <div className="mb-1" style={{ color: '#FF6B35' }}>
                            First Access Count: {firstAccessPoint.data.y.toLocaleString()}
                          </div>
                          <div style={{ color: '#0088FE' }}>
                            Last Access Count: {lastAccessPoint.data.y.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                  markers={[
                    {
                      axis: 'x',
                      value: data.expiryBlockWindow,
                      lineStyle: {
                        stroke: '#FFFFFF',
                        strokeWidth: 2,
                        strokeDasharray: '5 5',
                      },
                      legend: 'expiry threshold',
                      legendOrientation: 'vertical',
                      textStyle: {
                        fill: '#FFFFFF',
                        fontSize: 12,
                      },
                    },
                  ]}
                  legends={[
                    {
                      anchor: 'top-left',
                      direction: 'column',
                      justify: true,
                      translateX: 15,
                      translateY: 0,
                      itemsSpacing: 2,
                      itemDirection: 'left-to-right',
                      itemWidth: 100,
                      itemHeight: 20,
                      symbolSize: 12,
                      symbolShape: 'circle',
                    },
                  ]}
                />
              }
              series={[
                {
                  name: 'First Access',
                  color: '#0088FE',
                  min: Math.min(...data.storageAccessSeries.map(p => p.firstAccess)),
                  avg: Math.round(
                    data.storageAccessSeries.reduce((sum, p) => sum + p.firstAccess, 0) /
                      data.storageAccessSeries.length,
                  ),
                  max: Math.max(...data.storageAccessSeries.map(p => p.firstAccess)),
                  last:
                    data.storageAccessSeries[data.storageAccessSeries.length - 1]?.firstAccess || 0,
                },
                {
                  name: 'Last Access',
                  color: '#FF6B35',
                  min: Math.min(...data.storageAccessSeries.map(p => p.lastAccess)),
                  avg: Math.round(
                    data.storageAccessSeries.reduce((sum, p) => sum + p.lastAccess, 0) /
                      data.storageAccessSeries.length,
                  ),
                  max: Math.max(...data.storageAccessSeries.map(p => p.lastAccess)),
                  last:
                    data.storageAccessSeries[data.storageAccessSeries.length - 1]?.lastAccess || 0,
                },
              ]}
              height={400}
              showSeriesTable={false}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
