registerGame("pinball", "🎰 Pinball", "A/D = flippers", "Get the highest score!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a0a2e");
    this.walls=this.physics.add.staticGroup();
    [[W/2,10,W,20],[W/2,H-10,W,20],[10,H/2,20,H],[W-10,H/2,20,H]].forEach(([x,y,w,h])=>this.walls.add(this.add.rectangle(x,y,w,h,0x2a1a4e)));
    // Bumpers
    this.bumpers=this.physics.add.staticGroup();
    [[250,150],[400,200],[550,150],[300,320],[500,320]].forEach(([x,y])=>{
      const b=this.add.circle(x,y,24,0xe94560);this.bumpers.add(b);this.physics.add.existing(b,true);b.body.setCircle(24);
    });
    // Flippers
    this.flipL=this.add.rectangle(W/2-80,H-60,80,12,0xf7c948);this.flipR=this.add.rectangle(W/2+80,H-60,80,12,0xf7c948);
    [this.flipL,this.flipR].forEach(f=>{this.physics.add.existing(f,true);});
    // Ball
    this.ball=this.add.circle(W/2,100,8,0xffffff);this.physics.add.existing(this.ball);
    this.ball.body.setBounce(0.8).setGravityY(200).setCollideWorldBounds(true).setVelocity(Phaser.Math.Between(-100,100),200);
    this.physics.add.collider(this.ball,this.walls);
    this.physics.add.collider(this.ball,this.flipL,(b)=>{b.body.setVelocityY(-350);b.body.setVelocityX(-150);});
    this.physics.add.collider(this.ball,this.flipR,(b)=>{b.body.setVelocityY(-350);b.body.setVelocityX(150);});
    this.score=0;
    this.physics.add.collider(this.ball,this.bumpers,(b,bump)=>{
      this.score+=100;this.sTxt.setText("Score: "+this.score);
      const a=Phaser.Math.Angle.Between(bump.x,bump.y,b.x,b.y);
      b.body.setVelocity(Math.cos(a)*300,Math.sin(a)*300);
      this.tweens.add({targets:bump,scale:1.3,duration:50,yoyo:true});
    });
    this.sTxt=this.add.text(W/2,30,"Score: 0",{fontSize:"20px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D"});
  }
  update(){
    this.flipL.setRotation(this.k.a.isDown?-0.4:0.2);
    this.flipR.setRotation(this.k.d.isDown?0.4:-0.2);
    if(this.ball.y>H-20){this.ball.setPosition(W/2,100);this.ball.body.setVelocity(Phaser.Math.Between(-100,100),200);}
  }
});
