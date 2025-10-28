const mockStsAssumeRole = jest.fn();
const mockEc2DescribeVolumes = jest.fn();
const mockEc2DeleteVolume = jest.fn();
const mockEc2DescribeInstances = jest.fn();
const mockEc2StopInstances = jest.fn();
const mockCwGetMetricData = jest.fn();

jest.mock('aws-sdk', () => {
  return {
    STS: jest.fn().mockImplementation(() => ({
      assumeRole: mockStsAssumeRole.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' }
        })
      })
    })),
    EC2: jest.fn().mockImplementation(() => ({
      describeVolumes: mockEc2DescribeVolumes.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Volumes: [] })
      }),
      deleteVolume: mockEc2DeleteVolume.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      describeInstances: mockEc2DescribeInstances.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Reservations: [] })
      }),
      stopInstances: mockEc2StopInstances.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      })
    })),
    CloudWatch: jest.fn().mockImplementation(() => ({
      getMetricData: mockCwGetMetricData.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ MetricDataResults: [] })
      })
    })),
  };
});

const { handler: deleteUnusedEbsHandler } = require('../functions/delete-unused-ebs');
const { handler: stopIdleInstancesHandler } = require('../functions/stop-idle-instances');

describe('Funções de Automação', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('delete-unused-ebs', () => {
    const baseEvent = {
      customerId: 'cust-123',
      awsAccountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/TestRole',
    };

    test('deve excluir volumes "available" e ignorar volumes "in-use"', async () => {
    mockEc2DescribeVolumes.mockReturnValue({
    promise: jest.fn().mockResolvedValue({
    Volumes: [
      { VolumeId: 'vol-available', State: 'available' },
        { VolumeId: 'vol-in-use', State: 'in-use' },
        ],
        })
    });

    mockEc2DeleteVolume.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
    });

    await deleteUnusedEbsHandler(baseEvent);

      expect(mockStsAssumeRole).toHaveBeenCalledWith({
      RoleArn: baseEvent.roleArn,
        RoleSessionName: 'CostGuardianDeleteEBS',
    });

    expect(mockEc2DescribeVolumes).toHaveBeenCalled();

    expect(mockEc2DeleteVolume).toHaveBeenCalledWith({
    VolumeId: 'vol-available',
    });

      expect(mockEc2DeleteVolume).not.toHaveBeenCalledWith({
        VolumeId: 'vol-in-use',
      });
    });
  });

  describe('stop-idle-instances', () => {
    const baseEvent = {
      customerId: 'cust-123',
      awsAccountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/TestRole',
      idleThresholdMinutes: 60,
    };

    test('deve parar instâncias ociosas baseado no uso de CPU', async () => {
      mockEc2DescribeInstances.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Reservations: [
            {
              Instances: [
                {
                  InstanceId: 'i-123',
                  State: { Name: 'running' },
                  Tags: [{ Key: 'Name', Value: 'Test Instance' }],
                },
              ],
            },
          ],
        })
      });

      mockCwGetMetricData.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          MetricDataResults: [
            {
              Id: 'cpu_utilization',
              Values: [2.5], // CPU abaixo do threshold
            },
          ],
        })
      });

      mockEc2StopInstances.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      });

      await stopIdleInstancesHandler(baseEvent);

      expect(mockStsAssumeRole).toHaveBeenCalledWith({
        RoleArn: baseEvent.roleArn,
        RoleSessionName: 'CostGuardianStopIdle',
      });

      expect(mockEc2DescribeInstances).toHaveBeenCalled();

      expect(mockCwGetMetricData).toHaveBeenCalled();

      expect(mockEc2StopInstances).toHaveBeenCalledWith({
        InstanceIds: ['i-123'],
      });
    });
  });
});
