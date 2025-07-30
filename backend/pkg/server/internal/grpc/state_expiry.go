package grpc

import (
	"context"

	xpc "github.com/ethpandaops/lab/backend/pkg/server/internal/service/state_expiry"

	pb "github.com/ethpandaops/lab/backend/pkg/server/proto/state_expiry"
	"github.com/sirupsen/logrus"
	"google.golang.org/grpc"
)

const StateExpiryHandlerName = "grpc/state_expiry"

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

// GetStateExpiryInfo implements the GetStateExpiryInfo method of the StateExpiryServiceServer interface.
func (s *StateExpiry) GetStateExpiryInfo(ctx context.Context, req *pb.GetStateExpiryInfoRequest) (*pb.GetStateExpiryInfoResponse, error) {
	stateExpiryInfo, err := s.service.ReadStateExpiryInfo(ctx, req.Network)
	if err != nil {
		return nil, err
	}

	return &pb.GetStateExpiryInfoResponse{
		StateExpiryInfo: stateExpiryInfo,
	}, nil
}
