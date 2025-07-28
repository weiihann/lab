package stateexpiry

import (
	"errors"
	"fmt"
)

type Config struct {
	// Enable the state expiry service
	Enabled *bool `yaml:"enabled" json:"enabled"`

	// Redis key prefix for state expiry
	RedisKeyPrefix string `yaml:"redis_key_prefix" json:"redis_key_prefix"`

	// Number of blocks considered active from the latest block to (block - ActiveBlocks)
	// For example:
	//   Latest Block: 21000000
	//   ActiveBlocks: 2628000 (1 year considering 12 seconds per block)
	//   Active range is from block 18372000 to 21000000
	//   Expiry range is from block 0 to block 18371999
	ActiveBlocks int64 `yaml:"active_blocks" json:"active_blocks"`
}

func (c *Config) Validate() error {
	if c.Enabled != nil && !*c.Enabled {
		return nil
	}

	if c.RedisKeyPrefix == "" {
		return errors.New("redis_key_prefix is required")
	}

	if c.ActiveBlocks <= 0 {
		return fmt.Errorf("active_blocks must be greater than 0, got %d", c.ActiveBlocks)
	}

	return nil
}
