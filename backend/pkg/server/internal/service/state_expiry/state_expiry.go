package stateexpiry

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/ethpandaops/lab/backend/pkg/internal/lab/cache"
	"github.com/ethpandaops/lab/backend/pkg/internal/lab/ethereum"
	"github.com/ethpandaops/lab/backend/pkg/internal/lab/locker"
	"github.com/ethpandaops/lab/backend/pkg/internal/lab/metrics"
	"github.com/ethpandaops/lab/backend/pkg/internal/lab/storage"
	"github.com/ethpandaops/lab/backend/pkg/internal/lab/xatu"
	// "github.com/prometheus/client_golang/prometheus"
	"github.com/sirupsen/logrus"

	pb "github.com/ethpandaops/lab/backend/pkg/server/proto/state_expiry"
)

// TODO:
// 1. Add protoc generation for the proto file in MAKEFILE
// 2. Rename the tables for compliance with `canonoical_execution`
// 3. Use network
// 4. Add metrics

const (
	StateExpiryServiceName         = "state_expiry"
	AccountsInfoProcessorName      = "accounts"
	StorageInfoProcessorName       = "storage"
	AccessSeriesProcessorName      = "access_series"
	TopContractsBySlotsName        = "top_contracts_by_slots"
	TopContractsByExpiredSlotsName = "top_contracts_by_expired_slots"
	MaxBlockProcessorName          = "max_block"
)

type StateExpiry struct {
	log logrus.FieldLogger

	config *Config

	ethereumClient   *ethereum.Client
	xatuClient       *xatu.Client
	storageClient    storage.Client
	cacheClient      cache.Client
	lockerClient     locker.Locker
	metrics          *metrics.Metrics
	metricsCollector *metrics.Collector

	processCtx       context.Context //nolint:containedctx // this is a leader election context
	processCtxCancel context.CancelFunc

	// Base directory for storage
	baseDir string
}

func New(
	log logrus.FieldLogger,
	config *Config,
	ethereumClient *ethereum.Client,
	xatuClient *xatu.Client,
	storageClient storage.Client,
	cacheClient cache.Client,
	lockerClient locker.Locker,
) (*StateExpiry, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return &StateExpiry{
		log:              log.WithField("component", "service/"+StateExpiryServiceName),
		config:           config,
		ethereumClient:   ethereumClient,
		xatuClient:       xatuClient,
		storageClient:    storageClient,
		cacheClient:      cacheClient,
		lockerClient:     lockerClient,
		baseDir:          StateExpiryServiceName,
		processCtx:       nil,
		processCtxCancel: nil,
	}, nil
}

func (s *StateExpiry) Start(ctx context.Context) error {
	if s.config != nil && s.config.Enabled != nil && !*s.config.Enabled {
		s.log.Info("StateExpiry service disabled")
		return nil
	}

	s.log.Info("Starting StateExpiry service")

	ctx, cancel := context.WithCancel(context.Background())
	s.processCtx = ctx
	s.processCtxCancel = cancel

	go s.processLoop()

	return nil
}

func (s *StateExpiry) Stop() {
	s.log.Info("Stopping StateExpiry service")

	if s.processCtxCancel != nil {
		s.processCtxCancel()
	}

	s.log.Info("StateExpiry service stopped")
}

func (s *StateExpiry) processLoop() {
	ticker := time.NewTicker(time.Hour * 1)
	defer ticker.Stop()

	if s.processCtx == nil {
		s.log.Error("Process context is nil, cannot process")
		return
	}

	for {
		select {
		case <-s.processCtx.Done():
			s.log.Info("Context cancelled, stopping processing loop")
			return
		default:

		}

		s.process(s.processCtx)

		select {
		case <-s.processCtx.Done():
			s.log.Info("Context cancelled, stopping processing loop")
			return
		case <-ticker.C:
		}
	}
}

func (s *StateExpiry) process(ctx context.Context) error {
	s.log.Info("Starting processing cycle")

	networksToProcess := s.ethereumClient.Networks()

	for _, network := range networksToProcess {
		log := s.log.WithField("network", network.Name)
		log.Info("Processing network")

		// Get the expiry block
		maxBlock, err := s.getMaxBlock(ctx, network.Name)
		if err != nil {
			log.WithError(err).Error("Failed to get expiry block")
			return err
		}

		expiryBlock := maxBlock - s.config.ActiveBlocks

		// Get the accounts info
		accountsInfo, err := s.getAccountsInfo(ctx, network, expiryBlock)
		if err != nil {
			log.WithError(err).Error("Failed to get accounts info")
			return err
		}

		// Get the storage info
		storageInfo, err := s.getStorageInfo(ctx, network, expiryBlock)
		if err != nil {
			log.WithError(err).Error("Failed to get storage info")
			return err
		}

		// Get the access series
		startBlock := maxBlock - 7200 // 1 day worth of blocks
		accessSeries, err := s.getAccessSeries(ctx, network, startBlock, maxBlock)
		if err != nil {
			log.WithError(err).Error("Failed to get access series")
			return err
		}

		// Get the top contracts by slots
		topContractsBySlots, err := s.getTopContractsBySlots(ctx, network)
		if err != nil {
			log.WithError(err).Error("Failed to get top contracts by slots")
			return err
		}

		// Get the top contracts by expired slots
		topContractsByExpiredSlots, err := s.getTopContractsByExpiredSlots(ctx, network, expiryBlock)
		if err != nil {
			log.WithError(err).Error("Failed to get top contracts by expired slots")
			return err
		}

		// Create the state expiry info
		stateExpiryInfo := &pb.StateExpiryInfo{
			Accounts:                   accountsInfo,
			Storage:                    storageInfo,
			AccessSeries:               accessSeries,
			TopContractsBySlots:        topContractsBySlots,
			TopContractsByExpiredSlots: topContractsByExpiredSlots,
		}

		// Save the state expiry info
		if err := s.saveStateExpiryInfo(ctx, network, stateExpiryInfo); err != nil {
			log.WithError(err).Error("Failed to save state expiry info")
			return err
		}

		log.Info("Successfully processed state expiry info")
	}

	return nil
}

func (s *StateExpiry) getAccountsInfo(ctx context.Context, network *ethereum.Network, expiryBlock int64) (*pb.AccountsInfo, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": AccountsInfoProcessorName,
		"network":   network.Name,
	})
	log.Info("Processing accounts info")

	query := `
		SELECT
			-- Total contracts
			(SELECT count() 
			FROM default.canonical_execution_contracts FINAL
			) AS total_contract_accounts,

			-- Total accounts
			(SELECT count() 
			FROM default.accounts_state FINAL
			) AS total_accounts,
		
			-- Expired accounts
			(SELECT count() 
			FROM default.accounts_state FINAL
			WHERE last_access_block < ?
			) AS expired_accounts,
		
			-- Expired contracts
			(SELECT count() 
			FROM default.accounts_state AS a FINAL
			GLOBAL INNER JOIN (
			SELECT DISTINCT lower(contract_address) AS contract_address
			FROM default.canonical_execution_contracts FINAL
			) AS c
			ON a.address = c.contract_address
			WHERE a.last_access_block < ?
			) AS expired_contracts
	`

	networkLog := log.WithField("query_network", network.Name)
	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network.Name)
	if err != nil {
		networkLog.WithError(err).Error("Failed to get Clickhouse client for network")
		return nil, err
	}

	if clickhouseClient == nil {
		networkLog.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network.Name)
		return nil, fmt.Errorf("nil Clickhouse client for network %s", network.Name)
	}

	rows, err := clickhouseClient.Query(ctx, query, expiryBlock, expiryBlock)
	if err != nil {
		networkLog.WithError(err).Error("Failed to execute query")
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows returned for accounts info query on network %s", network.Name)
	}

	// Extract the first row
	row := rows[0]
	totalContractAccounts, err := strconv.ParseInt(fmt.Sprintf("%v", row["total_contract_accounts"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse total_contract_accounts: %w", err)
	}
	totalAccounts, err := strconv.ParseInt(fmt.Sprintf("%v", row["total_accounts"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse total_accounts: %w", err)
	}
	expiredAccounts, err := strconv.ParseInt(fmt.Sprintf("%v", row["expired_accounts"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse expired_accounts: %w", err)
	}
	expiredContracts, err := strconv.ParseInt(fmt.Sprintf("%v", row["expired_contracts"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse expired_contracts: %w", err)
	}

	return &pb.AccountsInfo{
		TotalContractAccounts: totalContractAccounts,
		TotalAccounts:         totalAccounts,
		ExpiredAccounts:       expiredAccounts,
		ExpiredContracts:      expiredContracts,
	}, nil
}

func (s *StateExpiry) getStorageInfo(ctx context.Context, network *ethereum.Network, expiryBlock int64) (*pb.StorageInfo, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": StorageInfoProcessorName,
		"network":   network.Name,
	})
	log.Info("Processing storage info")

	query := `
		SELECT
			-- Total storage slots
			(SELECT count() 
			FROM default.storage_state FINAL
			) AS total_storage_slots,

			-- Expired slots
			(SELECT count() 
			FROM default.storage_state FINAL
			WHERE last_access_block < ?
			) AS expired_storage_slots
	`

	networkLog := log.WithField("query_network", network.Name)
	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network.Name)
	if err != nil {
		networkLog.WithError(err).Error("Failed to get Clickhouse client for network")
		return nil, err
	}
	if clickhouseClient == nil {
		networkLog.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network.Name)
		return nil, fmt.Errorf("nil Clickhouse client for network %s", network.Name)
	}
	rows, err := clickhouseClient.Query(ctx, query, expiryBlock)
	if err != nil {
		networkLog.WithError(err).Error("Failed to execute query")
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows returned for storage info query on network %s", network.Name)
	}

	row := rows[0]
	totalStorageSlots, err := strconv.ParseInt(fmt.Sprintf("%v", row["total_storage_slots"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse total_storage_slots: %w", err)
	}
	expiredStorageSlots, err := strconv.ParseInt(fmt.Sprintf("%v", row["expired_storage_slots"]), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse expired_storage_slots: %w", err)
	}
	return &pb.StorageInfo{
		TotalStorageSlots:   totalStorageSlots,
		ExpiredStorageSlots: expiredStorageSlots,
	}, nil
}

func (s *StateExpiry) getAccessSeries(ctx context.Context, network *ethereum.Network, startBlock, endBlock int64) ([]*pb.AccessSeries, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": AccessSeriesProcessorName,
		"network":   network.Name,
	})
	log.Info("Processing access series")

	query := `
		SELECT
			block_number,
			countIf(source = 'read')  AS read_count,
			countIf(source = 'write') AS write_count
		FROM (
			-- Nonce & balance reads
			SELECT block_number, 'read'  AS source
			FROM default.canonical_execution_nonce_reads FINAL
			WHERE block_number BETWEEN ? AND ?

			UNION ALL
			SELECT block_number, 'read'
			FROM default.canonical_execution_balance_reads FINAL
			WHERE block_number BETWEEN ? AND ?

			-- Nonce & balance writes (diffs)
			UNION ALL
			SELECT block_number, 'write'
			FROM default.canonical_execution_nonce_diffs FINAL
			WHERE block_number BETWEEN ? AND ?

			UNION ALL
			SELECT block_number, 'write'
			FROM default.canonical_execution_balance_diffs FINAL
			WHERE block_number BETWEEN ? AND ?

			-- Storage reads
			UNION ALL
			SELECT block_number, 'read'
			FROM default.canonical_execution_storage_reads FINAL
			WHERE block_number BETWEEN ? AND ?

			-- Storage writes (diffs)
			UNION ALL
			SELECT block_number, 'write'
			FROM default.canonical_execution_storage_diffs FINAL
			WHERE block_number BETWEEN ? AND ?
		) AS events
		GROUP BY block_number
		ORDER BY block_number;
	`

	networkLog := log.WithField("query_network", network.Name)
	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network.Name)
	if err != nil {
		networkLog.WithError(err).Error("Failed to get Clickhouse client for network")
		return nil, err
	}

	if clickhouseClient == nil {
		networkLog.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network.Name)
		return nil, fmt.Errorf("nil Clickhouse client for network %s", network.Name)
	}
	rows, err := clickhouseClient.Query(ctx, query, startBlock, endBlock, startBlock, endBlock, startBlock, endBlock, startBlock, endBlock, startBlock, endBlock, startBlock, endBlock)
	if err != nil {
		networkLog.WithError(err).Error("Failed to execute query")
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows returned for access series query on network %s", network.Name)
	}

	// Extract the rows
	accessSeries := make([]*pb.AccessSeries, 0, endBlock-startBlock+1)
	for _, row := range rows {
		blockNumber, err := strconv.ParseUint(fmt.Sprintf("%v", row["block_number"]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse block_number: %w", err)
		}
		readCount, err := strconv.ParseInt(fmt.Sprintf("%v", row["read_count"]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse read_count: %w", err)
		}
		writeCount, err := strconv.ParseInt(fmt.Sprintf("%v", row["write_count"]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse write_count: %w", err)
		}
		accessSeries = append(accessSeries, &pb.AccessSeries{
			BlockNumber: blockNumber,
			ReadCount:   readCount,
			WriteCount:  writeCount,
		})
	}

	return accessSeries, nil
}

func (s *StateExpiry) getTopContractsBySlots(ctx context.Context, network *ethereum.Network) ([]*pb.ContractStorageTotalSlots, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": TopContractsBySlotsName,
		"network":   network.Name,
	})
	log.Info("Processing top contracts by slots")

	query := `
		SELECT
			address AS contract_address,
			uniqMerge(total_slots) AS total_slots
		FROM default.contract_storage_count_agg FINAL
		GROUP BY address
		ORDER BY total_slots DESC
		LIMIT 3;
	`

	// TODO(weiihann): Loop through networks and execute the query for each network
	networkLog := log.WithField("query_network", network.Name)
	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network.Name)
	if err != nil {
		networkLog.WithError(err).Error("Failed to get Clickhouse client for network")
		return nil, err
	}
	if clickhouseClient == nil {
		networkLog.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network.Name)
		return nil, fmt.Errorf("nil Clickhouse client for network %s", network.Name)
	}
	rows, err := clickhouseClient.Query(ctx, query)
	if err != nil {
		networkLog.WithError(err).Error("Failed to execute query")
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows returned for top contracts by slots query on network %s", network.Name)
	}

	// Extract the rows
	topContractsBySlots := make([]*pb.ContractStorageTotalSlots, 0, 3)
	for _, row := range rows {
		contractAddress, ok := row["contract_address"].(string)
		if !ok {
			return nil, fmt.Errorf("contract_address is not of type string for network %s", network.Name)
		}
		totalSlots, err := strconv.ParseInt(fmt.Sprintf("%v", row["total_slots"]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse total_slots: %w", err)
		}
		topContractsBySlots = append(topContractsBySlots, &pb.ContractStorageTotalSlots{
			ContractAddress: contractAddress,
			TotalSlots:      totalSlots,
		})
	}

	return topContractsBySlots, nil
}

func (s *StateExpiry) getTopContractsByExpiredSlots(ctx context.Context, network *ethereum.Network, expiryBlock int64) ([]*pb.ContractStorageExpiredSlots, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": TopContractsByExpiredSlotsName,
		"network":   network.Name,
	})
	log.Info("Processing top contracts by expired slots")

	query := `
		SELECT
			address   AS contract_address,
			count()   AS expired_slots
		FROM default.storage_state FINAL
		WHERE last_access_block < ?
		GROUP BY address
		ORDER BY expired_slots DESC
		LIMIT 3;
	`

	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network.Name)
	if err != nil {
		log.WithError(err).Error("Failed to get Clickhouse client for network")
		return nil, err
	}
	if clickhouseClient == nil {
		log.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network.Name)
		return nil, fmt.Errorf("nil Clickhouse client for network %s", network.Name)
	}
	rows, err := clickhouseClient.Query(ctx, query, expiryBlock)
	if err != nil {
		log.WithError(err).Error("Failed to execute query")
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows returned for top contracts by expired slots query on network %s", network.Name)
	}

	// Extract the rows
	topContractsByExpiredSlots := make([]*pb.ContractStorageExpiredSlots, 0, 3)
	for _, row := range rows {
		contractAddress, ok := row["contract_address"].(string)
		if !ok {
			return nil, fmt.Errorf("contract_address is not of type string for network %s", network.Name)
		}
		expiredSlots, err := strconv.ParseInt(fmt.Sprintf("%v", row["expired_slots"]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse expired_slots: %w", err)
		}
		topContractsByExpiredSlots = append(topContractsByExpiredSlots, &pb.ContractStorageExpiredSlots{
			ContractAddress: contractAddress,
			ExpiredSlots:    expiredSlots,
		})
	}

	return topContractsByExpiredSlots, nil
}

// Retrieves the maximum block number available in the database
func (s *StateExpiry) getMaxBlock(ctx context.Context, network string) (int64, error) {
	log := s.log.WithFields(logrus.Fields{
		"processor": MaxBlockProcessorName,
		"network":   network,
	})
	log.Info("Retrieving maximum block number")

	query := `
		SELECT
			max(block_number) AS max_block
		FROM default.canonical_execution_nonce_reads FINAL
		WHERE meta_network_name = ?
	`

	clickhouseClient, err := s.xatuClient.GetClickhouseClientForNetwork(network)
	if err != nil {
		log.WithError(err).Error("Failed to get Clickhouse client for network")
		return 0, err
	}
	if clickhouseClient == nil {
		log.Errorf("GetClickhouseClientForNetwork returned nil client without error for network %s", network)
		return 0, fmt.Errorf("nil Clickhouse client for network %s", network)
	}
	rows, err := clickhouseClient.Query(ctx, query, network)
	if err != nil {
		log.WithError(err).Error("Failed to execute query")
	}

	if len(rows) == 0 {
		return 0, fmt.Errorf("no rows returned for max block query on network %s", network)
	}

	maxBlock, err := strconv.ParseInt(fmt.Sprintf("%v", rows[0]["max_block"]), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse max_block: %w", err)
	}

	log.WithField("max_block", maxBlock).Info("Retrieved maximum block number")
	return maxBlock, nil
}

func (s *StateExpiry) Name() string {
	return StateExpiryServiceName
}

func (s *StateExpiry) saveStateExpiryInfo(ctx context.Context, network *ethereum.Network, stateExpiryInfo *pb.StateExpiryInfo) error {
	key := filepath.Join(network.Name, "state_expiry.json")

	if err := s.storageClient.Store(ctx, storage.StoreParams{
		Key:         s.getStoragePath(key),
		Data:        stateExpiryInfo,
		Format:      storage.CodecNameJSON,
		Compression: storage.Gzip,
	}); err != nil {
		return fmt.Errorf("failed to store state expiry info: %w", err)
	}

	s.log.Info("Successfully stored state expiry info")

	return nil
}

func (s *StateExpiry) getStoragePath(key string) string {
	return filepath.Join(s.baseDir, key)
}

func (s *StateExpiry) ReadStateExpiryInfo(ctx context.Context, networkName string) (*pb.StateExpiryInfo, error) {
	log := s.log.WithField("method", "ReadStateExpiryInfo")
	key := filepath.Join(networkName, "state_expiry.json")

	storagePath := s.getStoragePath(key)
	summary := &pb.StateExpiryInfo{}

	err := s.storageClient.GetEncoded(ctx, storagePath, summary, storage.CodecNameJSON)
	if err != nil {
		if err == storage.ErrNotFound {
			log.Warn("State expiry info not found in storage")

			return nil, storage.ErrNotFound // Return specific error for gRPC mapping
		}

		log.WithError(err).Error("Failed to get state expiry info from storage")

		return nil, fmt.Errorf("failed to get state expiry info: %w", err)
	}

	return summary, nil
}
