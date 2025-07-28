package grpc

import (
	"context"

	xpc "github.com/ethpandaops/lab/backend/pkg/server/internal/service/state_expiry"

	pb "github.com/ethpandaops/lab/backend/pkg/server/proto/state_expiry"
	"github.com/sirupsen/logrus"
	"google.golang.org/grpc"
)

type StateExpiry struct {
	pb.UnimplementedStateExpiryServiceServer
	log     logrus.FieldLogger
	service *xpc.StateExpiry
}

func NewStateExpiry(log logrus.FieldLogger, service *xpc.StateExpiry) *StateExpiry {
	return &StateExpiry{
		log:     log.WithField("component", "grpc/state_expiry"),
		service: service,
	}
}

func (s *StateExpiry) Name() string {
	return "state_expiry"
}

func (s *StateExpiry) Start(ctx context.Context, grpcServer *grpc.Server) error {
	pb.RegisterStateExpiryServiceServer(grpcServer, s)

	s.log.Info("StateExpiry GRPC service started")

	return nil
}
