registerGame("breakout", "🧱 Breakout", "← → move paddle", "Score race — who clears bricks fastest", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a1e");
    const colors = [0xe94560, 0xf7c948, 0x4ecca3, 0x5dade2, 0xaf7ac5];
    this.bricks = this.physics.add.staticGroup();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 12; c++)
      this.bricks.add(this.add.rectangle(80+c*55, 60+r*28, 50, 22, colors[r]));
    this.paddle = this.add.rectangle(W/2, H-40, 100, 14, 0xf7c948);
    this.physics.add.existing(this.paddle); this.paddle.body.setImmovable(true).setCollideWorldBounds(true);
    this.ball = this.add.circle(W/2, H-60, 7, 0xffffff);
    this.physics.add.existing(this.ball); this.ball.body.setBounce(1,1).setCollideWorldBounds(true).setVelocity(200,-280);
    this.physics.add.collider(this.ball, this.paddle, b => b.body.setVelocityX((b.x-this.paddle.x)*5));
    this.score = 0;
    this.scoreTxt = this.add.text(16, H-24, "Bricks: 0", { fontSize: "16px", color: "#f7c948", fontFamily: "monospace" });
    this.physics.add.collider(this.ball, this.bricks, (b, brick) => { brick.destroy(); this.scoreTxt.setText("Bricks: "+(++this.score)); });
    this.cursors = this.input.keyboard.createCursorKeys();
  }
  update() {
    this.paddle.body.setVelocityX(this.cursors.left.isDown?-400:this.cursors.right.isDown?400:0);
    if (this.ball.y > H-10) { this.ball.setPosition(W/2,H-60); this.ball.body.setVelocity(200,-280); }
  }
});
