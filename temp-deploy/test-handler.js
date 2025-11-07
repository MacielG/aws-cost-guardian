// Test handler simples para diagnóstico
module.exports.testHandler = async (event) => {
  console.log('TEST HANDLER SIMPLES EXECUTADO');
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Test handler simples working',
      timestamp: new Date().toISOString()
    })
  };
};
