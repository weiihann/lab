import { useEffect, useState } from 'react';
import { Card, CardBody } from '../../components/common/Card';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { IntegratedContextualHeader } from '../../components/layout/IntegratedContextualHeader';
import { getLabApiClient } from '../../api';
import { GetStateExpiryInfoRequest } from '../../api/gen/backend/pkg/api/proto/lab_api_pb';
import { StateExpiryInfo } from '../../api/gen/backend/pkg/server/proto/state_expiry/state_expiry_pb';
import { ChartWithStats, NivoLineChart } from '../../components/charts';
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
  readCountTrend: Array<{ block: number; count: number }>;
  writeCountTrend: Array<{ block: number; count: number }>;
}

export default function StateExpiryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StateExpiryData | null>(null);
  const [network] = useState('mainnet');

  const transformStateExpiryData = (info: StateExpiryInfo): StateExpiryData => {
    const accounts = info.accounts;
    const storage = info.storage;
    const accessSeries = info.accessSeries;

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

    // Transform access series data (last 7200 blocks)
    const last7200Blocks = accessSeries.slice(-7200);
    const readCountTrend = last7200Blocks.map(entry => ({
      block: Number(entry.blockNumber),
      count: Number(entry.readCount),
    }));

    const writeCountTrend = last7200Blocks.map(entry => ({
      block: Number(entry.blockNumber),
      count: Number(entry.writeCount),
    }));

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
      readCountTrend,
      writeCountTrend,
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
    <div className="container mx-auto px-4 py-8">
      <IntegratedContextualHeader
        title="State Expiry Analysis"
        description="Comprehensive analysis of Ethereum state expiry metrics including account statistics, storage utilization, and access patterns."
      />

      <div className="space-y-8">
        {/* Account Statistics */}
        <section className="mb-16">
          <h2 className="text-2xl font-sans font-bold text-primary mb-6">Account Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Total EOA Accounts */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">
                    Total EOA Accounts
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalEOAAccounts.toLocaleString()}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Total Contract Accounts */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">
                    Total Contract Accounts
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalContractAccounts.toLocaleString()}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Total Storage Slots */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">
                    Total Storage Slots
                  </h3>
                  <div className="text-4xl font-mono font-bold text-accent">
                    {data.totalStorageSlots.toLocaleString()}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </section>

        {/* Contract Rankings */}
        <section className="mb-16">
          <h2 className="text-2xl font-sans font-bold text-primary mb-6">Top Contracts</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 3 Contracts by Storage Slots */}
            <Card>
              <CardBody>
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
                          className="text-xs font-mono text-tertiary truncate max-w-[200px]"
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
              </CardBody>
            </Card>

            {/* Top 3 Contracts by Expired Storage Slots */}
            <Card>
              <CardBody>
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
                          className="text-xs font-mono text-tertiary truncate max-w-[200px]"
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
              </CardBody>
            </Card>
          </div>
        </section>

        {/* Expiry Percentages */}
        <section className="mb-16">
          <h2 className="text-2xl font-sans font-bold text-primary mb-6">Expiry Percentages</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Overall Expiry Percentage */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">Overall Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.overallExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Contract Accounts Expiry */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">Contract Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.contractAccountsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* EOA Accounts Expiry */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">EOA Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.eoaAccountsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Storage Slots Expiry */}
            <Card>
              <CardBody>
                <div className="text-center">
                  <h3 className="text-lg font-sans font-bold text-primary mb-2">Storage Expiry</h3>
                  <div className="text-4xl font-mono font-bold text-warning">
                    {data.storageSlotsExpiryPercentage.toFixed(2)}%
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </section>

        {/* Access Patterns Charts */}
        <section className="mb-16">
          <h2 className="text-2xl font-sans font-bold text-primary mb-6">
            Access Patterns (Last 7200 Blocks)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Read Count Trend Chart */}
            <ChartWithStats
              title="Read Count Trend"
              description="Number of read operations per block over the last 7200 blocks"
              chart={
                <NivoLineChart
                  data={[
                    {
                      id: 'reads',
                      data: data.readCountTrend.map(point => ({
                        x: point.block,
                        y: point.count,
                      })),
                    },
                  ]}
                  axisBottom={{
                    legend: 'Block Number',
                    legendOffset: 36,
                  }}
                  axisLeft={{
                    legend: 'Read Count',
                    legendOffset: -40,
                  }}
                  colors={['#0088FE']}
                />
              }
              series={[
                {
                  name: 'Reads',
                  color: '#0088FE',
                  min: Math.min(...data.readCountTrend.map(p => p.count)),
                  avg: Math.round(
                    data.readCountTrend.reduce((sum, p) => sum + p.count, 0) /
                      data.readCountTrend.length,
                  ),
                  max: Math.max(...data.readCountTrend.map(p => p.count)),
                  last: data.readCountTrend[data.readCountTrend.length - 1]?.count || 0,
                },
              ]}
              height={400}
            />

            {/* Write Count Trend Chart */}
            <ChartWithStats
              title="Write Count Trend"
              description="Number of write operations per block over the last 7200 blocks"
              chart={
                <NivoLineChart
                  data={[
                    {
                      id: 'writes',
                      data: data.writeCountTrend.map(point => ({
                        x: point.block,
                        y: point.count,
                      })),
                    },
                  ]}
                  axisBottom={{
                    legend: 'Block Number',
                    legendOffset: 36,
                  }}
                  axisLeft={{
                    legend: 'Write Count',
                    legendOffset: -40,
                  }}
                  colors={['#FF6B35']}
                />
              }
              series={[
                {
                  name: 'Writes',
                  color: '#FF6B35',
                  min: Math.min(...data.writeCountTrend.map(p => p.count)),
                  avg: Math.round(
                    data.writeCountTrend.reduce((sum, p) => sum + p.count, 0) /
                      data.writeCountTrend.length,
                  ),
                  max: Math.max(...data.writeCountTrend.map(p => p.count)),
                  last: data.writeCountTrend[data.writeCountTrend.length - 1]?.count || 0,
                },
              ]}
              height={400}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
