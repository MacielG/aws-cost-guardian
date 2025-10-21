const https = require('https');
const response = require('cfn-response');  // Layer ou npm i cfn-response

exports.handler = async (event, context) => {
  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      const responseData = {
        RoleArn: event.ResourceProperties.RoleArn || 'arn:example',  // Puxe do evento
        Status: 'SUCCESS',
      };
      await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          Status: 'SUCCESS',
          Reason: 'Onboarding Activated',
          PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
          Data: responseData,
        });

        const options = {
          hostname: new URL(event.ResponseURL).hostname,
          port: 443,
          path: new URL(event.ResponseURL).pathname,
          method: 'POST',
          headers: {
            'content-type': '',
            'content-length': Buffer.byteLength(postData),
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log('Callback sent:', data);
            resolve();
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      response.send(event, context, response.SUCCESS, responseData);
    } else {
      response.send(event, context, response.SUCCESS, {});
    }
  } catch (err) {
    console.error(err);
    response.send(event, context, response.FAILED, { Error: err.message });
  }
};