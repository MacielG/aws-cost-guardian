const mockSTS = jest.fn();
const mockEC2 = jest.fn();
const mockCloudWatch = jest.fn();

jest.mock('aws-sdk', () => {
  return {
    STS: mockSTS,
    EC2: mockEC2,
    CloudWatch: mockCloudWatch,
  };
});

const { handler: deleteUnusedEbsHandler } = require('../functions/delete-unused-ebs');
const { handler: stopIdleInstancesHandler } = require('../functions/stop-idle-instances');

describe('Funções de Automação', () => {
  let mockStsPromise;
  let mockEc2Promise;
  let mockCwPromise;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStsPromise = jest.fn().mockResolvedValue({
      Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' },
    });
    mockEc2Promise = jest.fn();
    mockCwPromise = jest.fn();

    mockSTS.prototype.assumeRole = jest.fn(() => ({ promise: mockStsPromise }));
    mockEC2.prototype.describeVolumes = jest.fn(() => ({ promise: mockEc2Promise }));
    mockEC2.prototype.deleteVolume = jest.fn(() => ({ promise: mockEc2Promise }));
    mockEC2.prototype.describeInstances = jest.fn(() => ({ promise: mockEc2Promise }));
    mockEC2.prototype.stopInstances = jest.fn(() => ({ promise: mockEc2Promise }));
    mockCloudWatch.prototype.getMetricData = jest.fn(() => ({ promise: mockCwPromise }));
  });

  describe('delete-unused-ebs', () => {
    const baseEvent = {
      customerId: 'cust-123',
      awsAccountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/TestRole',
    };

    test('deve excluir volumes "available" e ignorar volumes "in-use"', async () => {
      mockEc2Promise.mockResolvedValueOnce({
        Volumes: [
          { VolumeId: 'vol-available', State: 'available' },
          { VolumeId: 'vol-in-use', State: 'in-use' },
        ],
      });

      mockEc2Promise.mockResolvedValueOnce({});

      await deleteUnusedEbsHandler(baseEvent);

      expect(mockSTS.prototype.assumeRole).toHaveBeenCalledWith({
        RoleArn: baseEvent.roleArn,
        RoleSessionName: 'CostGuardianDeleteEBS',
      });

      expect(mockEC2.prototype.describeVolumes).toHaveBeenCalled();

      expect(mockEC2.prototype.deleteVolume).toHaveBeenCalledWith({
        VolumeId: 'vol-available',
      });

      expect(mockEC2.prototype.deleteVolume).not.toHaveBeenCalledWith({
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
      mockEc2Promise.mockResolvedValueOnce({
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
      });

      mockCwPromise.mockResolvedValueOnce({
        MetricDataResults: [
          {
            Id: 'cpu_utilization',
            Values: [2.5], // CPU abaixo do threshold
          },
        ],
      });

      mockEc2Promise.mockResolvedValueOnce({});

      await stopIdleInstancesHandler(baseEvent);

      expect(mockSTS.prototype.assumeRole).toHaveBeenCalledWith({
        RoleArn: baseEvent.roleArn,
        RoleSessionName: 'CostGuardianStopIdle',
      });

      expect(mockEC2.prototype.describeInstances).toHaveBeenCalled();

      expect(mockCloudWatch.prototype.getMetricData).toHaveBeenCalled();

      expect(mockEC2.prototype.stopInstances).toHaveBeenCalledWith({
        InstanceIds: ['i-123'],
      });
    });
  });
});
